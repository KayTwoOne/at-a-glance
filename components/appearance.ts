/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { useGlanceConfig } from "../data";

/**
 * True when Discord's base theme is light - measured, not guessed: a probe
 * element resolves `--text-default` to actual rgb (the text colour always flips
 * with the base theme, Nitro gradient themes included), and dark text means a
 * light theme behind it. Re-measures when Discord swaps theme classes on <html>.
 */
export function useOnLightTheme(): boolean {
    const [light, setLight] = React.useState(false);

    React.useEffect(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--text-default, var(--text-normal, #fff))";
        probe.style.display = "none";
        document.body.appendChild(probe);

        const measure = () => {
            try {
                const rgb = getComputedStyle(probe).color.match(/\d+/g);
                if (!rgb) return;
                const [r, g, b] = rgb.map(Number);
                setLight(0.2126 * r + 0.7152 * g + 0.0722 * b < 128);
            } catch { }
        };
        measure();

        const observer = new MutationObserver(measure);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => {
            observer.disconnect();
            probe.remove();
        };
    }, []);

    return light;
}

/** Relative luminance (0–1) of a #rrggbb colour, for contrast decisions */
function luminance(hex: string): number {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return 0;
    const chan = (h: string) => {
        const v = parseInt(h, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(m[1]) + 0.7152 * chan(m[2]) + 0.0722 * chan(m[3]);
}

/**
 * Live material/background classes + CSS custom properties for any At a glance
 * surface (main layer, channel popup, prompt/customize modals).
 *
 * The intensity slider is 0-100 in the UI but capped in rendering - 100% maps
 * to a 45% tint so a maxed slider stays usable instead of a solid colour wall.
 *
 * Background modes: "theme" follows Discord's client/Nitro theme (translucent);
 * "solid"/"gradient" paint an OPAQUE background that overrides the theme, and
 * add a `vc-glance-bg-override` class so cards become opaque too (otherwise the
 * theme would still bleed through them). When an override background is light,
 * `vc-glance-bg-light` flips text/icon colours to dark for legibility.
 */
export function useAppearance(): { materialClass: string; style: React.CSSProperties; } {
    const { appearance } = useGlanceConfig();
    const override = appearance.backgroundMode !== "theme";

    // Decide light vs dark content from the effective background luminance
    const bgLum = appearance.backgroundMode === "solid"
        ? luminance(appearance.backgroundColor)
        : appearance.backgroundMode === "gradient"
            ? (luminance(appearance.primary) + luminance(appearance.accent)) / 2
            : 0;
    const light = override && bgLum > 0.55;

    const classes = [
        `vc-glance-material-${appearance.material}`,
        `vc-glance-bg-${appearance.backgroundMode}`,
        override ? "vc-glance-bg-override" : "",
        light ? "vc-glance-bg-light" : "",
        appearance.nameColor ? "vc-glance-custom-name" : ""
    ].filter(Boolean).join(" ");

    const style: React.CSSProperties = {
        "--vcg-primary": appearance.primary,
        "--vcg-accent": appearance.accent,
        "--vcg-tint": `${(appearance.intensity * 0.45).toFixed(1)}%`,
        "--vcg-tint-soft": `${(appearance.intensity * 0.28).toFixed(1)}%`,
        "--vcg-angle": `${appearance.angle}deg`,
        "--vcg-bg": appearance.backgroundColor,
        "--vcg-surface-opacity": `${appearance.surfaceOpacity}%`
    } as React.CSSProperties;
    if (appearance.nameColor) (style as any)["--vcg-name"] = appearance.nameColor;

    return { materialClass: ` ${classes}`, style };
}
