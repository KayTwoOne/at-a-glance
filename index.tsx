/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Channel, User } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { closeGlanceIfOpen, openGlance } from "./components/GlanceLayer";
import { GlanceTab } from "./components/GlanceTab";
import {
    addBookmark,
    isBookmarked,
    isChannelWatched,
    isUserPinned,
    loadConfig,
    removeBookmark,
    togglePinnedUser,
    toggleWatchedChannel
} from "./data";
import { comboKey, comboParts, matchesKeyboardCombo, modifiersMatch, MOUSE_KEY_NAMES } from "./hotkeys";
import { startReminderScheduler, stopReminderScheduler } from "./reminderScheduler";
import { settings } from "./settings";

// Channel types that make sense on the watchlist. Explicit allowlist - anything
// else (categories, directories, unknown future types) is not offered.
const WATCHABLE_CHANNEL_TYPES = new Set([
    0, // GUILD_TEXT
    2, // GUILD_VOICE
    3, // GROUP_DM
    5, // GUILD_ANNOUNCEMENT
    13, // STAGE_VOICE
    15 // GUILD_FORUM
]);

// If the sidebar patch ever breaks on a Discord update, the tab disappears but
// nothing crashes and these context menu entries keep working.
const SafeGlanceTab = ErrorBoundary.wrap(GlanceTab, { noop: true });

function makeWatchMenuItem(channel: Channel) {
    return (
        <Menu.MenuItem
            id="vc-glance-watch-channel"
            label={isChannelWatched(channel.id) ? "Unwatch on At a glance" : "Watch on At a glance"}
            action={() => toggleWatchedChannel(channel.id)}
        />
    );
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user?.id || user.id === UserStore.getCurrentUser()?.id) return;

    const group = findGroupChildrenByChildId("close-dm", children)
        ?? findGroupChildrenByChildId("block", children)
        ?? children;

    group.push(
        <Menu.MenuItem
            id="vc-glance-pin-user"
            label={isUserPinned(user.id) ? "Unpin from At a glance" : "Pin to At a glance"}
            action={() => togglePinnedUser(user.id)}
        />
    );
};

const ChannelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !WATCHABLE_CHANNEL_TYPES.has(channel.type)) return;

    const group = findGroupChildrenByChildId("mute-channel", children) ?? children;
    group.push(makeWatchMenuItem(channel));
};

const GroupDmContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !WATCHABLE_CHANNEL_TYPES.has(channel.type)) return;

    const group = findGroupChildrenByChildId("leave-channel", children) ?? children;
    group.push(makeWatchMenuItem(channel));
};

/** Where a saved message lives, for the bookmark row's location line */
function describeMessageLocation(channel: Channel | undefined): string {
    if (!channel) return "Unknown";
    if (channel.isDM?.()) return "Direct message";
    if (channel.isMultiUserDM?.()) return channel.name || "Group DM";
    return `#${channel.name}`;
}

const MessageContext: NavContextMenuPatchCallback = (children, { message, channel }: { message?: any; channel?: Channel; }) => {
    if (!message?.id || !message?.channel_id) return;

    const saved = isBookmarked(message.id);
    children.push(
        <Menu.MenuItem
            id="vc-glance-bookmark"
            label={saved ? "Remove from At a glance" : "Save to At a glance"}
            action={() => {
                if (saved) {
                    removeBookmark(message.id);
                    return;
                }
                // Plain-text snapshot only - renders instantly forever, no refetch
                addBookmark({
                    channelId: message.channel_id,
                    messageId: message.id,
                    authorId: message.author?.id,
                    guildId: channel?.getGuildId?.() ?? undefined,
                    authorName: message.author?.globalName || message.author?.username || "Unknown",
                    snippet: String(message.content ?? "").slice(0, 160)
                        || (message.attachments?.length ? "(attachment)" : "(no text)"),
                    location: describeMessageLocation(channel)
                });
            }}
        />
    );
};

/* ========== quick-pin hotkey ========== */

/**
 * One hotkey, context-aware: a DM pins/unpins that friend; a guild/group
 * channel is added to/removed from the watchlist.
 */
function quickPinChannel(channelId: string | null | undefined) {
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel) {
        showToast("Nothing here to pin to At a glance.", Toasts.Type.FAILURE);
        return;
    }

    if (channel.isDM()) {
        const userId = channel.getRecipientId();
        if (!userId) return;
        const user = UserStore.getUser(userId);
        const name = user?.globalName || user?.username || "this user";
        const wasPinned = isUserPinned(userId);
        togglePinnedUser(userId);
        showToast(
            wasPinned ? `Unpinned ${name} from At a glance.` : `Pinned ${name} to At a glance.`,
            Toasts.Type.SUCCESS
        );
        return;
    }

    if (WATCHABLE_CHANNEL_TYPES.has(channel.type)) {
        const label = channel.name || "channel";
        const wasWatched = isChannelWatched(channel.id);
        toggleWatchedChannel(channel.id);
        showToast(
            wasWatched ? `Removed #${label} from At a glance.` : `Watching #${label} on At a glance.`,
            Toasts.Type.SUCCESS
        );
        return;
    }

    showToast("This channel type can't be pinned.", Toasts.Type.FAILURE);
}

function onHotkeyKeydown(e: KeyboardEvent) {
    const combo = settings.store.pinHotkey?.trim();
    if (!combo || !matchesKeyboardCombo(e, combo)) return;

    // Bare-key combos stay out of the way while typing; with ctrl/alt/meta
    // held the hotkey works everywhere, including the message box
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, [contenteditable=\"true\"]")) return;
    }

    e.preventDefault();
    quickPinChannel(SelectedChannelStore.getChannelId());
}

/** Channel id from whatever sidebar/channel link the mouse is over, if any */
function channelIdFromEvent(e: MouseEvent): string | null {
    const link = (e.target as HTMLElement | null)
        ?.closest?.("a[href*='/channels/']") as HTMLAnchorElement | null;
    const match = link?.getAttribute("href")?.match(/\/channels\/(?:@me|\d+)\/(\d{17,21})/);
    return match?.[1] ?? null;
}

/**
 * Mouse binding (default ctrl+middleclick). Runs in the capture phase on
 * window - before Discord's own handlers and the browser default - so the
 * combo never triggers Discord's middle-click behaviour (opening the DM/
 * channel in a new window, autoscroll, etc.). Plain middle-click without the
 * combo's modifiers is left completely untouched.
 */
function onMouseHotkey(e: MouseEvent) {
    if (e.button !== 1) return;

    const combo = settings.store.pinHotkey?.trim();
    if (!combo) return;

    const key = comboKey(combo);
    if (!key || !MOUSE_KEY_NAMES.has(key) || !modifiersMatch(e, comboParts(combo))) return;

    e.preventDefault();
    e.stopPropagation();

    // Suppress every event in the middle-click sequence, but act only once
    if (e.type === "mousedown") {
        quickPinChannel(channelIdFromEvent(e) ?? SelectedChannelStore.getChannelId());
    }
}

const MOUSE_HOTKEY_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick"] as const;

let startupOpened = false;

export default definePlugin({
    name: "AtAGlance",
    description: "A customizable 'At a glance' tab above the Friends button: pinned friends with quick actions, watched voice/text channels, tools and integrations - all in one Discord-native view.",
    authors: [{ name: "Kaylum", id: 0n }],

    settings,

    contextMenus: {
        "user-context": UserContext,
        "channel-context": ChannelContext,
        "gdm-context": GroupDmContext,
        "message": MessageContext
    },

    patches: [
        // Inserts the At a glance tab as the first static row of the DM sidebar
        // list, right above the Friends button. Same module PinDMs anchors on,
        // so upstream keeps the find string alive.
        {
            find: '.FRIENDS},"friends"',
            replacement: {
                match: /(?<=listScrollerRef:\i,children:\[)/,
                replace: "$self.renderGlanceTab(),"
            }
        }
    ],

    flux: {
        // Config is stored per account, so (re)load it whenever a connection
        // opens - covers startup, reconnects and account switching
        CONNECTION_OPEN() {
            loadConfig();

            if (settings.store.openOnStartup && !startupOpened) {
                startupOpened = true;
                // Give the base UI a moment to settle before taking the stage
                setTimeout(openGlance, 800);
            }
        },
        LOGOUT() {
            closeGlanceIfOpen();
        }
    },

    start() {
        // In case the plugin is enabled while Discord is already connected
        loadConfig();
        startReminderScheduler();
        window.addEventListener("keydown", onHotkeyKeydown);
        for (const type of MOUSE_HOTKEY_EVENTS) {
            window.addEventListener(type, onMouseHotkey as EventListener, true);
        }
    },

    stop() {
        stopReminderScheduler();
        window.removeEventListener("keydown", onHotkeyKeydown);
        for (const type of MOUSE_HOTKEY_EVENTS) {
            window.removeEventListener(type, onMouseHotkey as EventListener, true);
        }
        closeGlanceIfOpen();
    },

    renderGlanceTab() {
        return <SafeGlanceTab key="vc-glance-tab" />;
    },

    // Handy for keybind tooling and the console; not used internally
    openGlance
});
