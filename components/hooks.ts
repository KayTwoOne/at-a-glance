/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

/** Current epoch ms, refreshed on an interval - clocks, countdowns, "due" checks */
export function useNow(intervalMs: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

/**
 * Re-renders on an interval while `enabled`, without carrying any state of its
 * own. For data Discord doesn't emit store updates for (e.g. voice states in
 * guilds you aren't viewing) where reading fresh on each render is enough.
 */
export function usePoll(intervalMs: number, enabled: boolean) {
    const [, tick] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        if (!enabled) return;
        const id = setInterval(tick, intervalMs);
        return () => clearInterval(id);
    }, [intervalMs, enabled]);
}
