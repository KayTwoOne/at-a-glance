/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import { UserStore } from "@webpack/common";

import { openGlance } from "./components/GlanceLayer";
import { markReminderNotified, pendingReminderNotifications } from "./data";

const logger = new Logger("AtAGlance");

let intervalId: ReturnType<typeof setInterval> | undefined;
let startupTimeoutId: ReturnType<typeof setTimeout> | undefined;

function tick() {
    const due = pendingReminderNotifications();
    if (due.length === 0) return;

    const me = UserStore.getCurrentUser();
    const icon = me?.getAvatarURL?.(void 0, 64, false);

    for (const reminder of due) {
        try {
            showNotification({
                title: "⏰ Reminder - At a glance",
                body: reminder.text,
                icon,
                color: "var(--brand-500, #5865f2)",
                onClick: openGlance
            });
        } catch (e) {
            logger.error("Failed to show reminder notification", e);
        }
        markReminderNotified(reminder.id);
    }
}

/** Starts the background reminder ticker (fires even when the view is closed) */
export function startReminderScheduler() {
    if (intervalId) return;
    // A 20s cadence keeps timed reminders punctual without meaningful cost
    intervalId = setInterval(tick, 20_000);
    // Catch anything already due at startup shortly after boot settles
    startupTimeoutId = setTimeout(tick, 4_000);
}

export function stopReminderScheduler() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
    }
    if (startupTimeoutId) {
        clearTimeout(startupTimeoutId);
        startupTimeoutId = undefined;
    }
}
