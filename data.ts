/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { React, UserStore } from "@webpack/common";

const logger = new Logger("AtAGlance");

export type WidgetGroup = "social" | "tools";

export const WIDGET_META = [
    { id: "pinned-friends", label: "Pinned Friends", group: "social" },
    { id: "quick-access", label: "Quick Access Channels", group: "social" },
    { id: "mentions", label: "Inbox", group: "social" },
    { id: "bookmarks", label: "Saved Messages", group: "social" },
    { id: "events", label: "Upcoming Events", group: "social" },
    { id: "quick-tools", label: "Quick Tools", group: "tools" },
    { id: "reminders", label: "Reminders", group: "tools" },
    { id: "integrations", label: "Integrations & Notes", group: "tools" },
    { id: "client-perf", label: "Client Performance", group: "tools" },
    // Optional remote control for the separate OrionQuests plugin. Off unless the
    // user opts in via Add Widget, and inert unless that plugin is also enabled.
    { id: "orion", label: "Orion", group: "tools", defaultHidden: true }
] as const satisfies ReadonlyArray<{ id: string; label: string; group: WidgetGroup; defaultHidden?: boolean; }>;

export type WidgetId = typeof WIDGET_META[number]["id"];
const WIDGET_IDS = WIDGET_META.map(w => w.id) as WidgetId[];
/** Widgets that start hidden - shown only once the user enables them */
const DEFAULT_HIDDEN_WIDGETS = WIDGET_META
    .filter(w => "defaultHidden" in w && w.defaultHidden)
    .map(w => w.id) as WidgetId[];

export interface WeatherLocation {
    name: string;
    lat: number;
    lon: number;
}

export type GlanceMaterial = "classic" | "acrylic" | "glass";
export const GLANCE_MATERIALS: GlanceMaterial[] = ["classic", "acrylic", "glass"];

/** How the page background is painted:
 *  - theme: follow Discord's client/Nitro theme (default; translucent surfaces)
 *  - solid: an opaque colour that overrides the theme entirely
 *  - gradient: an opaque primary→accent gradient that overrides the theme */
export type GlanceBackgroundMode = "theme" | "solid" | "gradient";
export const GLANCE_BG_MODES: GlanceBackgroundMode[] = ["theme", "solid", "gradient"];

export interface GlanceAppearance {
    material: GlanceMaterial;
    /** Base tint colour for the cards, #rrggbb */
    primary: string;
    /** Secondary tint / shine colour, #rrggbb */
    accent: string;
    /** 0-100 slider; rendering caps the real effect so 100 stays tasteful */
    intensity: number;
    /** Gradient/shine direction in degrees, 0-360 */
    angle: number;
    /** Page background source (theme override) */
    backgroundMode: GlanceBackgroundMode;
    /** Solid background colour when backgroundMode === "solid", #rrggbb */
    backgroundColor: string;
    /** 0-100: how opaque the widget cards are over an override background */
    surfaceOpacity: number;
    /** Greeting-name colour override, #rrggbb; null = follow the accent gradient */
    nameColor: string | null;
}

export const DEFAULT_APPEARANCE: GlanceAppearance = {
    material: "classic",
    primary: "#5865f2",
    accent: "#00a8fc",
    intensity: 0,
    angle: 135,
    backgroundMode: "solid",
    backgroundColor: "#171717",
    surfaceOpacity: 90,
    nameColor: null
};

export interface GlanceConfig {
    version: 3;
    /** User IDs pinned to the "Pinned Friends" widget */
    pinnedUsers: string[];
    /** Channel IDs in "Quick Access" (guild text/voice, group DMs); split by type at render */
    watchedChannels: string[];
    /** Free-form quick notes, rendered as plain text only */
    notes: string;
    /** Location for the weather card, chosen by the user via search */
    weatherLocation: WeatherLocation | null;
    /** Widgets hidden via the "Add Widget" menu */
    hiddenWidgets: WidgetId[];
    /** Widgets currently collapsed to just their header */
    collapsedWidgets: WidgetId[];
    /** Quick Access guild sections collapsed to just their header (guild id, or "dm") */
    collapsedGuilds: string[];
    /** Display order - a sanitized permutation of all widget ids */
    widgetOrder: WidgetId[];
    /** Material/colour customization */
    appearance: GlanceAppearance;
    /** Saved messages: IDs + a plain-text snapshot so rows render instantly forever */
    bookmarks: GlanceBookmark[];
    /** Custom reminders, optionally timed */
    reminders: GlanceReminder[];
}

export interface GlanceBookmark {
    channelId: string;
    messageId: string;
    /** Author id, for the DM/message mini-avatar */
    authorId?: string;
    /** Guild id when the message is in a server, for the server icon */
    guildId?: string;
    authorName: string;
    snippet: string;
    location: string;
    savedAt: number;
}

export interface GlanceReminder {
    id: string;
    text: string;
    /** Epoch ms when it should trigger; null = untimed note-style reminder */
    dueAt: number | null;
    createdAt: number;
    /** True once the background scheduler has fired a desktop notification */
    notified?: boolean;
}

const MAX_BOOKMARKS = 100;
const MAX_REMINDERS = 50;
const MAX_REMINDER_TEXT = 200;

// Hard caps so a corrupted or maliciously edited IndexedDB entry can never
// balloon into unbounded memory/render work.
const MAX_PINNED_USERS = 50;
const MAX_WATCHED_CHANNELS = 100;
const MAX_NOTES_LENGTH = 20_000;
const MAX_LOCATION_NAME = 80;

// Discord snowflakes are 17-21 digit decimal strings. Every ID persisted by
// this plugin must match this shape; anything else is dropped on load.
const SNOWFLAKE_RE = /^\d{17,21}$/;

function freshConfig(): GlanceConfig {
    return {
        version: 3,
        pinnedUsers: [],
        watchedChannels: [],
        notes: "",
        weatherLocation: null,
        hiddenWidgets: [...DEFAULT_HIDDEN_WIDGETS],
        collapsedWidgets: [],
        collapsedGuilds: [],
        widgetOrder: [...WIDGET_IDS],
        appearance: { ...DEFAULT_APPEARANCE },
        bookmarks: [],
        reminders: []
    };
}

let config: GlanceConfig = freshConfig();
// The account the in-memory config belongs to. Mutations are not persisted
// until a load for a known account has happened, so one account's data can
// never be written to another account's storage key.
let loadedForUser: string | null = null;

const listeners = new Set<() => void>();

function storageKey(userId: string) {
    return `AtAGlance_${userId}`;
}

/** Pre-rename storage key; migrated transparently on first load */
function legacyStorageKey(userId: string) {
    return `Dashboard_${userId}`;
}

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (e) {
            logger.error("Config listener errored", e);
        }
    }
}

function sanitizeIdList(value: unknown, max: number): string[] {
    if (!Array.isArray(value)) return [];

    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !SNOWFLAKE_RE.test(item)) continue;
        if (out.includes(item)) continue;
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
}

export function sanitizeLocation(value: unknown): WeatherLocation | null {
    if (typeof value !== "object" || value === null) return null;
    const { name, lat, lon } = value as Record<string, unknown>;

    if (typeof name !== "string" || name.length === 0) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
    if (typeof lon !== "number" || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;

    return { name: name.slice(0, MAX_LOCATION_NAME), lat, lon };
}

function sanitizeWidgetIdList(value: unknown): WidgetId[] {
    if (!Array.isArray(value)) return [];
    return WIDGET_IDS.filter(id => value.includes(id));
}

/**
 * Like sanitizeWidgetIdList, but keeps default-hidden widgets hidden for users
 * upgrading from a config that predates them. A default-hidden widget the stored
 * order has never listed is brand-new to this user, so it starts hidden; once
 * they've seen it (it's in their saved order) their explicit choice is honoured.
 */
function migrateHiddenWidgets(hidden: unknown, storedOrder: unknown): WidgetId[] {
    const out = sanitizeWidgetIdList(hidden);
    const known = Array.isArray(storedOrder) ? storedOrder : [];
    for (const id of DEFAULT_HIDDEN_WIDGETS) {
        if (!out.includes(id) && !known.includes(id)) out.push(id);
    }
    return out;
}

// Quick Access groups its watched channels by server; the collapse key is a
// guild snowflake or the literal "dm" bucket for private channels.
const GUILD_COLLAPSE_KEY_RE = /^(?:\d{17,21}|dm)$/;
function sanitizeGuildCollapseList(value: unknown, max = 100): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !GUILD_COLLAPSE_KEY_RE.test(item)) continue;
        if (out.includes(item)) continue;
        out.push(item);
        if (out.length >= max) break;
    }
    return out;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}

export function sanitizeAppearance(raw: unknown): GlanceAppearance {
    const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return {
        material: GLANCE_MATERIALS.includes(source.material as GlanceMaterial)
            ? source.material as GlanceMaterial
            : DEFAULT_APPEARANCE.material,
        primary: typeof source.primary === "string" && HEX_COLOR_RE.test(source.primary)
            ? source.primary.toLowerCase()
            : DEFAULT_APPEARANCE.primary,
        accent: typeof source.accent === "string" && HEX_COLOR_RE.test(source.accent)
            ? source.accent.toLowerCase()
            : DEFAULT_APPEARANCE.accent,
        intensity: clampNumber(source.intensity, 0, 100, DEFAULT_APPEARANCE.intensity),
        angle: clampNumber(source.angle, 0, 360, DEFAULT_APPEARANCE.angle),
        backgroundMode: GLANCE_BG_MODES.includes(source.backgroundMode as GlanceBackgroundMode)
            ? source.backgroundMode as GlanceBackgroundMode
            : DEFAULT_APPEARANCE.backgroundMode,
        backgroundColor: typeof source.backgroundColor === "string" && HEX_COLOR_RE.test(source.backgroundColor)
            ? source.backgroundColor.toLowerCase()
            : DEFAULT_APPEARANCE.backgroundColor,
        surfaceOpacity: clampNumber(source.surfaceOpacity, 0, 100, DEFAULT_APPEARANCE.surfaceOpacity),
        nameColor: typeof source.nameColor === "string" && HEX_COLOR_RE.test(source.nameColor)
            ? source.nameColor.toLowerCase()
            : null
    };
}

/** Stored order filtered to known ids, with any missing ids appended in default order */
/**
 * Preserves the INPUT order (deduped, valid ids only), then appends any widgets
 * missing from it. NOTE: must NOT use sanitizeWidgetIdList here - that iterates
 * WIDGET_IDS (default order) and would throw away the user's custom ordering,
 * resetting layout on every save/load.
 */
function sanitizeWidgetOrder(value: unknown): WidgetId[] {
    const out: WidgetId[] = [];
    if (Array.isArray(value)) {
        for (const id of value) {
            if (WIDGET_IDS.includes(id as WidgetId) && !out.includes(id as WidgetId)) {
                out.push(id as WidgetId);
            }
        }
    }
    for (const id of WIDGET_IDS) {
        if (!out.includes(id)) out.push(id);
    }
    return out;
}

/**
 * Validates untrusted data (from IndexedDB) into a well-formed config.
 * Only explicitly known fields are copied over; unknown keys are discarded.
 * Transparently migrates v1/v2 configs (same core fields, fewer keys).
 */
export function sanitizeConfig(raw: unknown): GlanceConfig {
    const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    return {
        version: 3,
        pinnedUsers: sanitizeIdList(source.pinnedUsers, MAX_PINNED_USERS),
        watchedChannels: sanitizeIdList(source.watchedChannels, MAX_WATCHED_CHANNELS),
        notes: typeof source.notes === "string" ? source.notes.slice(0, MAX_NOTES_LENGTH) : "",
        weatherLocation: sanitizeLocation(source.weatherLocation),
        hiddenWidgets: migrateHiddenWidgets(source.hiddenWidgets, source.widgetOrder),
        collapsedWidgets: sanitizeWidgetIdList(source.collapsedWidgets),
        collapsedGuilds: sanitizeGuildCollapseList(source.collapsedGuilds),
        widgetOrder: sanitizeWidgetOrder(source.widgetOrder),
        appearance: sanitizeAppearance(source.appearance),
        bookmarks: sanitizeBookmarks(source.bookmarks),
        reminders: sanitizeReminders(source.reminders)
    };
}

function cleanString(value: unknown, max: number): string {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function sanitizeBookmarks(value: unknown): GlanceBookmark[] {
    if (!Array.isArray(value)) return [];
    const out: GlanceBookmark[] = [];
    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) continue;
        const b = raw as Record<string, unknown>;
        if (typeof b.channelId !== "string" || !SNOWFLAKE_RE.test(b.channelId)) continue;
        if (typeof b.messageId !== "string" || !SNOWFLAKE_RE.test(b.messageId)) continue;
        if (out.some(existing => existing.messageId === b.messageId)) continue;
        out.push({
            channelId: b.channelId,
            messageId: b.messageId,
            authorId: typeof b.authorId === "string" && SNOWFLAKE_RE.test(b.authorId) ? b.authorId : undefined,
            guildId: typeof b.guildId === "string" && SNOWFLAKE_RE.test(b.guildId) ? b.guildId : undefined,
            authorName: cleanString(b.authorName, 40),
            snippet: cleanString(b.snippet, 160),
            location: cleanString(b.location, 80),
            savedAt: typeof b.savedAt === "number" && Number.isFinite(b.savedAt) ? b.savedAt : 0
        });
        if (out.length >= MAX_BOOKMARKS) break;
    }
    return out;
}

function sanitizeReminders(value: unknown): GlanceReminder[] {
    if (!Array.isArray(value)) return [];
    const out: GlanceReminder[] = [];
    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        const text = cleanString(r.text, MAX_REMINDER_TEXT).trim();
        if (!text) continue;
        const id = cleanString(r.id, 32) || `${Date.now()}-${out.length}`;
        if (out.some(existing => existing.id === id)) continue;
        out.push({
            id,
            text,
            dueAt: typeof r.dueAt === "number" && Number.isFinite(r.dueAt) ? r.dueAt : null,
            createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
            notified: r.notified === true
        });
        if (out.length >= MAX_REMINDERS) break;
    }
    return out;
}

/* ---- bookmarks ---- */

export function isBookmarked(messageId: string) {
    return config.bookmarks.some(b => b.messageId === messageId);
}

export function addBookmark(bookmark: Omit<GlanceBookmark, "savedAt">) {
    if (isBookmarked(bookmark.messageId)) return;
    if (config.bookmarks.length >= MAX_BOOKMARKS) {
        logger.warn("Bookmark list is full");
        return;
    }
    const [clean] = sanitizeBookmarks([{ ...bookmark, savedAt: Date.now() }]);
    if (!clean) return;
    config.bookmarks.unshift(clean);
    emit();
    persist();
}

export function removeBookmark(messageId: string) {
    const index = config.bookmarks.findIndex(b => b.messageId === messageId);
    if (index === -1) return;
    config.bookmarks.splice(index, 1);
    emit();
    persist();
}

/* ---- reminders ---- */

export function addReminder(text: string, dueAt: number | null) {
    const [clean] = sanitizeReminders([{
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        dueAt,
        createdAt: Date.now(),
        notified: false
    }]);
    if (!clean || config.reminders.length >= MAX_REMINDERS) return;
    config.reminders.push(clean);
    emit();
    persist();
}

export function removeReminder(id: string) {
    const index = config.reminders.findIndex(r => r.id === id);
    if (index === -1) return;
    config.reminders.splice(index, 1);
    emit();
    persist();
}

export function snoozeReminder(id: string, ms: number) {
    const reminder = config.reminders.find(r => r.id === id);
    if (!reminder) return;
    reminder.dueAt = Date.now() + ms;
    reminder.notified = false;
    emit();
    persist();
}

/** Marks a reminder's desktop notification as fired (scheduler bookkeeping) */
export function markReminderNotified(id: string) {
    const reminder = config.reminders.find(r => r.id === id);
    if (!reminder || reminder.notified) return;
    reminder.notified = true;
    persist();
}

/** Reminders whose timer has fired and are waiting for attention */
export function triggeredReminderCount(now = Date.now()) {
    return config.reminders.filter(r => r.dueAt !== null && r.dueAt <= now).length;
}

/** Due reminders that haven't yet fired a desktop notification */
export function pendingReminderNotifications(now = Date.now()): GlanceReminder[] {
    return config.reminders.filter(r => r.dueAt !== null && r.dueAt <= now && !r.notified);
}

export function setAppearance(patch: Partial<GlanceAppearance>) {
    config.appearance = sanitizeAppearance({ ...config.appearance, ...patch });
    emit();
    persist(200);
}

export async function loadConfig() {
    const meId = UserStore.getCurrentUser()?.id;
    if (!meId || !SNOWFLAKE_RE.test(meId)) return;

    try {
        let raw = await DataStore.get(storageKey(meId));
        if (raw === undefined) {
            // One-time migration from the old "Dashboard" plugin name
            raw = await DataStore.get(legacyStorageKey(meId));
            if (raw !== undefined) {
                await DataStore.set(storageKey(meId), sanitizeConfig(raw));
                await DataStore.del(legacyStorageKey(meId)).catch(() => { });
            }
        }
        config = sanitizeConfig(raw);
        loadedForUser = meId;
    } catch (e) {
        logger.error("Failed to load config", e);
        config = freshConfig();
        loadedForUser = meId;
    }
    emit();
}

let persistTimeout: ReturnType<typeof setTimeout> | undefined;

function persist(debounceMs = 0) {
    if (!loadedForUser) return;
    clearTimeout(persistTimeout);
    persistTimeout = setTimeout(async () => {
        if (!loadedForUser) return;
        try {
            await DataStore.set(storageKey(loadedForUser), config);
        } catch (e) {
            logger.error("Failed to save config", e);
        }
    }, debounceMs);
}

export function getConfig(): GlanceConfig {
    return config;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** React hook returning the live config, re-rendering on any change */
export function useGlanceConfig(): GlanceConfig {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => subscribe(forceUpdate), []);
    return config;
}

export function isUserPinned(userId: string) {
    return config.pinnedUsers.includes(userId);
}

export function isChannelWatched(channelId: string) {
    return config.watchedChannels.includes(channelId);
}

function toggleId(list: string[], id: string, max: number) {
    if (!SNOWFLAKE_RE.test(id)) return;

    const index = list.indexOf(id);
    if (index === -1) {
        if (list.length >= max) {
            logger.warn("List is full, not adding", id);
            return;
        }
        list.push(id);
    } else {
        list.splice(index, 1);
    }

    emit();
    persist();
}

export function togglePinnedUser(userId: string) {
    toggleId(config.pinnedUsers, userId, MAX_PINNED_USERS);
}

export function toggleWatchedChannel(channelId: string) {
    toggleId(config.watchedChannels, channelId, MAX_WATCHED_CHANNELS);
}

/** Moves a pinned user up (-1) or down (+1) */
export function movePinnedUser(id: string, delta: -1 | 1) {
    moveWithinSubset(config.pinnedUsers, id, delta, config.pinnedUsers);
}

/** True when `next` is exactly a reordering of `current` (no adds/drops/dupes) */
function isPermutation(current: string[], next: string[]): boolean {
    if (next.length !== current.length) return false;
    const set = new Set(current);
    return new Set(next).size === next.length && next.every(id => set.has(id));
}

/** Replaces the pinned-friends order wholesale (drag & drop commit) */
export function setPinnedOrder(orderedIds: string[]) {
    if (!isPermutation(config.pinnedUsers, orderedIds)) return;
    config.pinnedUsers = [...orderedIds];
    emit();
    persist();
}

/** Replaces the watched-channel order wholesale (server drag & drop commit -
 *  section order is derived from where each server's channels first appear) */
export function setWatchedChannelsOrder(orderedIds: string[]) {
    if (!isPermutation(config.watchedChannels, orderedIds)) return;
    config.watchedChannels = [...orderedIds];
    emit();
    persist();
}

/**
 * Moves a watched channel up/down relative to its *visible* siblings.
 * `subsetIds` is the rendered sub-list (e.g. only voice channels), so a voice
 * channel never swaps past text channels stored between them.
 */
export function moveWatchedChannel(id: string, delta: -1 | 1, subsetIds: string[]) {
    moveWithinSubset(config.watchedChannels, id, delta, subsetIds);
}

function moveWithinSubset(master: string[], id: string, delta: -1 | 1, subsetIds: string[]) {
    const subsetPos = subsetIds.indexOf(id);
    const neighborId = subsetIds[subsetPos + delta];
    if (subsetPos === -1 || neighborId === undefined) return;

    const from = master.indexOf(id);
    const to = master.indexOf(neighborId);
    if (from === -1 || to === -1) return;

    [master[from], master[to]] = [master[to], master[from]];
    emit();
    persist();
}

export function setNotes(text: string) {
    if (typeof text !== "string") return;
    config.notes = text.slice(0, MAX_NOTES_LENGTH);
    // No emit: notes are edited through a controlled textarea; re-rendering
    // every keystroke through the global listener list is wasted work
    persist(800);
}

export function setWeatherLocation(location: WeatherLocation | null) {
    config.weatherLocation = location === null ? null : sanitizeLocation(location);
    emit();
    persist();
}

export function toggleWidgetHidden(id: WidgetId) {
    if (!WIDGET_IDS.includes(id)) return;
    const index = config.hiddenWidgets.indexOf(id);
    if (index === -1) config.hiddenWidgets.push(id);
    else config.hiddenWidgets.splice(index, 1);
    emit();
    persist();
}

export function isWidgetCollapsed(id: WidgetId) {
    return config.collapsedWidgets.includes(id);
}

export function toggleWidgetCollapsed(id: WidgetId) {
    if (!WIDGET_IDS.includes(id)) return;
    const index = config.collapsedWidgets.indexOf(id);
    if (index === -1) config.collapsedWidgets.push(id);
    else config.collapsedWidgets.splice(index, 1);
    emit();
    persist();
}

export function isGuildCollapsed(guildKey: string) {
    return config.collapsedGuilds.includes(guildKey);
}

/** Collapse/expand a Quick Access server section (guild snowflake, or "dm") */
export function toggleGuildCollapsed(guildKey: string) {
    if (!GUILD_COLLAPSE_KEY_RE.test(guildKey)) return;
    const index = config.collapsedGuilds.indexOf(guildKey);
    if (index === -1) config.collapsedGuilds.push(guildKey);
    else config.collapsedGuilds.splice(index, 1);
    emit();
    persist();
}

/** Replaces one group's ordering wholesale (drag & drop commit) */
export function setGroupOrder(group: WidgetGroup, orderedIds: WidgetId[]) {
    const valid = orderedIds.filter(id => WIDGET_META.find(m => m.id === id)?.group === group);
    const others = config.widgetOrder.filter(id => WIDGET_META.find(m => m.id === id)?.group !== group);
    config.widgetOrder = sanitizeWidgetOrder([...valid, ...others]);
    emit();
    persist();
}

/** Moves a widget up/down within its own group's display order */
export function moveWidget(id: WidgetId, delta: -1 | 1) {
    const group = WIDGET_META.find(w => w.id === id)?.group;
    if (!group) return;

    const groupIds = config.widgetOrder.filter(w =>
        WIDGET_META.find(m => m.id === w)?.group === group
    );
    moveWithinSubset(config.widgetOrder, id, delta, groupIds);
}

/** Widgets of a group in display order (hidden ones excluded) */
export function useOrderedWidgets(group: WidgetGroup): WidgetId[] {
    const { widgetOrder, hiddenWidgets } = useGlanceConfig();
    return widgetOrder.filter(id =>
        WIDGET_META.find(m => m.id === id)?.group === group && !hiddenWidgets.includes(id)
    );
}
