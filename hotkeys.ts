/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Shared parsing/matching for user-configurable hotkey combos like
 *  "shift+space", "ctrl+shift+p" or the mouse combo "ctrl+middleclick". */

const MODIFIER_NAMES = new Set(["ctrl", "control", "shift", "alt", "meta", "cmd", "win"]);
export const MOUSE_KEY_NAMES = new Set(["middleclick", "middle", "mmb", "m3"]);

export function comboParts(combo: string): string[] {
    return combo.toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
}

/** The non-modifier key of a combo (e.g. "space", "p", "middleclick") */
export function comboKey(combo: string): string | undefined {
    return comboParts(combo).find(p => !MODIFIER_NAMES.has(p));
}

export function modifiersMatch(
    e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; },
    parts: string[]
): boolean {
    return e.ctrlKey === (parts.includes("ctrl") || parts.includes("control"))
        && e.shiftKey === parts.includes("shift")
        && e.altKey === parts.includes("alt")
        && e.metaKey === (parts.includes("meta") || parts.includes("cmd") || parts.includes("win"));
}

/** Normalises a keyboard event's key to a combo token (space is special) */
function eventKeyToken(e: KeyboardEvent): string {
    if (e.key === " " || e.code === "Space") return "space";
    return e.key.toLowerCase();
}

const DISPLAY_NAMES: Record<string, string> = {
    ctrl: "Ctrl", control: "Ctrl", shift: "Shift", alt: "Alt",
    meta: "Cmd", cmd: "Cmd", win: "Win", space: "Space",
    middleclick: "Middle Click", middle: "Middle Click", mmb: "Middle Click", m3: "Middle Click"
};

/** Pretty label for a combo, e.g. "shift+space" -> "Shift Space" */
export function formatCombo(combo: string): string {
    return comboParts(combo)
        .map(p => DISPLAY_NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p))
        .join(" ");
}

/** True if a keyboard event matches a keyboard (non-mouse) combo exactly */
export function matchesKeyboardCombo(e: KeyboardEvent, combo: string): boolean {
    const parts = comboParts(combo);
    const key = parts.find(p => !MODIFIER_NAMES.has(p));
    if (!key || MOUSE_KEY_NAMES.has(key)) return false;
    return eventKeyToken(e) === key && modifiersMatch(e, parts);
}
