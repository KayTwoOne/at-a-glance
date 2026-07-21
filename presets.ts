/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GlanceAppearance } from "./data";

export interface GlancePreset {
    id: string;
    label: string;
    /** [primary, accent] for the two-tone swatch chip */
    swatch: [string, string];
    /** Merged into the live appearance through setAppearance() */
    apply: Partial<GlanceAppearance>;
}

/* Palettes seeded from established community themes.
 * Presets set colour and material only: intensity and angle too, kept subtle.
 * They deliberately leave the background (backgroundMode, backgroundColor) to the user. */
export const GLANCE_PRESETS: GlancePreset[] = [
    { id: "magenta", label: "Magenta", swatch: ["#d33699", "#00a8fc"], apply: { primary: "#d33699", accent: "#00a8fc", material: "acrylic", intensity: 22, angle: 135 } },
    { id: "nord", label: "Nord", swatch: ["#88c0d0", "#5e81ac"], apply: { primary: "#5e81ac", accent: "#88c0d0", material: "acrylic", intensity: 22, angle: 135 } },
    { id: "dracula", label: "Dracula", swatch: ["#bd93f9", "#ff79c6"], apply: { primary: "#bd93f9", accent: "#ff79c6", material: "glass", intensity: 16, angle: 135 } },
    { id: "catppuccin", label: "Catppuccin Mocha", swatch: ["#cba6f7", "#f5c2e7"], apply: { primary: "#cba6f7", accent: "#f5c2e7", material: "acrylic", intensity: 22, angle: 135 } },
    { id: "rosepine", label: "Rosé Pine", swatch: ["#c4a7e7", "#ebbcba"], apply: { primary: "#c4a7e7", accent: "#ebbcba", material: "glass", intensity: 16, angle: 135 } },
    { id: "mono", label: "Mono", swatch: ["#80848e", "#b5bac1"], apply: { primary: "#80848e", accent: "#b5bac1", material: "acrylic", intensity: 14, angle: 135 } }
];
