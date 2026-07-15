/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { React } from "@webpack/common";

import { useNow } from "./hooks";

/*
 * Plug-and-play bridge to the *separate*, optional OrionQuests plugin.
 *
 * OrionQuests publishes a control object on `window.__ORION_QUESTS_BRIDGE__`
 * while it's loaded and removes it on unload. At a glance NEVER imports that
 * plugin - it only ever feature-detects this global - so the two build and ship
 * independently and the Orion widget is inert (a friendly prompt) whenever the
 * plugin isn't installed or enabled.
 *
 * Everything on the other side of the bridge is treated as untrusted: the shape
 * is validated, the version is checked, dashboard rows are sanitized, and every
 * call is wrapped so a throwing or malformed engine can never crash the widget
 * or the dashboard around it.
 */

const BRIDGE_KEY = "__ORION_QUESTS_BRIDGE__";
/** Contract version this build understands. Bumped only on breaking changes. */
const SUPPORTED_VERSION = 1;

const logger = new Logger("AtAGlance:Orion");

export interface OrionTask {
    id: string;
    name: string;
    type: string;
    cur: number;
    max: number;
    status: string;
}

/** The raw, unvalidated object OrionQuests puts on `window`. */
interface RawOrionBridge {
    version: number;
    start(): Promise<string>;
    stop(): string;
    isRunning(): boolean;
    readDashboard(): unknown;
    subscribe(fn: () => void): () => void;
    statusSummary(): string;
}

const REQUIRED_METHODS: Array<keyof RawOrionBridge> = [
    "start", "stop", "isRunning", "readDashboard", "subscribe", "statusSummary"
];

/** Detection result: absent, present-but-wrong-version, or usable. */
export type OrionProbe =
    | { kind: "absent"; }
    | { kind: "incompatible"; version: unknown; }
    | { kind: "ready"; raw: RawOrionBridge; };

function probeBridge(): OrionProbe {
    const raw = (window as any)[BRIDGE_KEY];
    if (!raw || typeof raw !== "object") return { kind: "absent" };
    if (REQUIRED_METHODS.some(m => typeof raw[m] !== "function")) return { kind: "absent" };
    if (raw.version !== SUPPORTED_VERSION) return { kind: "incompatible", version: raw.version };
    return { kind: "ready", raw: raw as RawOrionBridge };
}

/** Coerce whatever readDashboard() returned into a clean, render-safe list. */
function sanitizeTasks(value: unknown): OrionTask[] {
    if (!Array.isArray(value)) return [];
    const out: OrionTask[] = [];
    for (const row of value) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const id = typeof r.id === "string" ? r.id : null;
        if (!id) continue;
        const cur = Number(r.cur);
        const max = Number(r.max);
        out.push({
            id,
            name: typeof r.name === "string" ? r.name : "Quest",
            type: typeof r.type === "string" ? r.type : "",
            status: typeof r.status === "string" ? r.status : "",
            cur: Number.isFinite(cur) ? cur : 0,
            max: Number.isFinite(max) ? max : 0
        });
        if (out.length >= 50) break; // never let a runaway list blow up the card
    }
    return out;
}

/** Run a bridge call, logging and swallowing anything it throws. */
function guard<T>(label: string, fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch (e) {
        logger.error(`bridge ${label}() threw`, e);
        return fallback;
    }
}

/** Live, validated view of the Orion engine, safe to use unconditionally. */
export interface OrionView {
    /** "absent" = not installed/enabled, "incompatible" = version mismatch, "ready" = usable */
    status: OrionProbe["kind"];
    running: boolean;
    tasks: OrionTask[];
    /** Starts the engine; returns false if the bridge wasn't usable */
    start(): Promise<boolean>;
    /** Stops the engine; returns false if the bridge wasn't usable */
    stop(): boolean;
    /** One-line summary, or null if unavailable */
    summary(): string | null;
}

/**
 * Subscribes to the engine, re-detects it as the plugin is toggled at runtime,
 * and returns a validated snapshot plus safe control methods. Polls on a modest
 * interval so enabling/disabling OrionQuests is reflected without a reload.
 */
export function useOrion(): OrionView {
    useNow(1500);
    const [, bump] = React.useReducer((x: number) => x + 1, 0);

    const probe = probeBridge();
    const ready = probe.kind === "ready" ? probe.raw : null;

    // Re-subscribe whenever the underlying bridge object changes identity (it's
    // stable while Orion stays loaded, and swaps when Orion reloads).
    React.useEffect(() => {
        if (!ready) return;
        try {
            const unsub = ready.subscribe(bump);
            return typeof unsub === "function" ? unsub : undefined;
        } catch (e) {
            logger.error("bridge subscribe() threw", e);
        }
    }, [ready]);

    const running = ready ? guard("isRunning", () => !!ready.isRunning(), false) : false;
    const tasks = ready ? sanitizeTasks(guard("readDashboard", () => ready.readDashboard(), [])) : [];

    return {
        status: probe.kind,
        running,
        tasks,
        async start() {
            if (!ready) return false;
            try {
                await ready.start();
                return true;
            } catch (e) {
                logger.error("bridge start() threw", e);
                return false;
            } finally {
                bump();
            }
        },
        stop() {
            if (!ready) return false;
            const ok = guard("stop", () => { ready.stop(); return true; }, false);
            bump();
            return ok;
        },
        summary() {
            if (!ready) return null;
            const s = guard("statusSummary", () => ready.statusSummary(), null as string | null);
            return typeof s === "string" ? s : null;
        }
    };
}
