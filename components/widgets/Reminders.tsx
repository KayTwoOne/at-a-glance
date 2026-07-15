/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { moment, React, Tooltip } from "@webpack/common";

import {
    addReminder,
    GlanceReminder,
    removeReminder,
    snoozeReminder,
    triggeredReminderCount,
    useGlanceConfig
} from "../../data";
import { Dropdown } from "../Dropdown";
import { useNow } from "../hooks";
import { CheckIcon, CloseIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

const DUE_PRESETS: Array<{ label: string; value: string; }> = [
    { label: "No timer", value: "none" },
    { label: "In 5 minutes", value: "300000" },
    { label: "In 15 minutes", value: "900000" },
    { label: "In 30 minutes", value: "1800000" },
    { label: "In 1 hour", value: "3600000" },
    { label: "In 3 hours", value: "10800000" },
    { label: "Tomorrow 09:00", value: "tomorrow9" },
    { label: "Custom duration…", value: "custom" }
];

/**
 * Parses a HHH:MM:SS / MM:SS / SS duration string into milliseconds.
 * Returns null for anything empty or malformed.
 */
export function parseDurationMs(value: string): number | null {
    const parts = value.trim().split(":").map(p => p.trim());
    if (parts.length < 1 || parts.length > 3) return null;
    if (parts.some(p => !/^\d{1,3}$/.test(p))) return null;

    const nums = parts.map(Number);
    let h = 0, m = 0, s = 0;
    if (nums.length === 3) [h, m, s] = nums;
    else if (nums.length === 2) [m, s] = nums;
    else [s] = nums;

    const totalMs = ((h * 3600) + (m * 60) + s) * 1000;
    return totalMs > 0 ? totalMs : null;
}

function resolveDue(preset: string, customValue: string): number | null {
    if (preset === "none") return null;
    if (preset === "tomorrow9") {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        date.setHours(9, 0, 0, 0);
        return date.getTime();
    }
    if (preset === "custom") {
        const ms = parseDurationMs(customValue);
        return ms !== null ? Date.now() + ms : null;
    }
    const ms = Number(preset);
    return Number.isFinite(ms) ? Date.now() + ms : null;
}

/** Relative time that never throws even if moment is unavailable */
function safeFromNow(ts: number): string {
    try {
        return moment(ts).fromNow();
    } catch {
        const diffMin = Math.round((ts - Date.now()) / 60000);
        if (diffMin === 0) return "now";
        return diffMin > 0 ? `in ${diffMin}m` : `${-diffMin}m ago`;
    }
}

function ReminderRow({ reminder, now }: { reminder: GlanceReminder; now: number; }) {
    const triggered = reminder.dueAt !== null && reminder.dueAt <= now;

    return (
        <div className={"vc-glance-row vc-glance-reminder-row" + (triggered ? " vc-glance-reminder-triggered" : "")}>
            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">{reminder.text}</span>
                <span className="vc-glance-row-subtitle">
                    {reminder.dueAt === null
                        ? "No timer"
                        : triggered
                            ? `Due ${safeFromNow(reminder.dueAt)}`
                            : `Fires ${safeFromNow(reminder.dueAt)}`}
                </span>
            </div>
            <div className="vc-glance-row-actions">
                {triggered && (
                    <Tooltip text="Snooze 15 minutes">
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-link-button"
                                onClick={() => snoozeReminder(reminder.id, 15 * 60 * 1000)}
                            >
                                Snooze
                            </button>
                        )}
                    </Tooltip>
                )}
                <Tooltip text="Done">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button vc-glance-reminder-done"
                            onClick={() => removeReminder(reminder.id)}
                        >
                            <CheckIcon size={15} />
                        </button>
                    )}
                </Tooltip>
                <Tooltip text="Delete">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={() => removeReminder(reminder.id)}
                        >
                            <CloseIcon size={14} />
                        </button>
                    )}
                </Tooltip>
            </div>
        </div>
    );
}

export function RemindersWidget() {
    const { reminders } = useGlanceConfig();
    // Tick fast enough that "fires in 1m" flipping to triggered feels immediate
    const now = useNow(15_000);

    const [text, setText] = React.useState("");
    const [preset, setPreset] = React.useState("none");
    const [customValue, setCustomValue] = React.useState("");

    const triggered = triggeredReminderCount(now);

    const customInvalid = preset === "custom" && parseDurationMs(customValue) === null;

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed || customInvalid) return;
        addReminder(trimmed, resolveDue(preset, customValue));
        setText("");
    };

    const sorted = [...reminders].sort((a, b) => {
        const aDue = a.dueAt ?? Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt ?? Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
    });

    return (
        <WidgetCard id="reminders" attention={triggered}>
            <div className="vc-glance-stack">
                <div className="vc-glance-reminder-form">
                    <input
                        className="vc-glance-input"
                        type="text"
                        maxLength={200}
                        placeholder="Remind me to…"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") submit(); }}
                    />
                    <div className="vc-glance-reminder-form-row">
                        <Dropdown
                            className="vc-glance-reminder-select"
                            options={DUE_PRESETS}
                            value={preset}
                            onChange={setPreset}
                            ariaLabel="Reminder timer"
                        />
                        {preset === "custom" && (
                            <input
                                className={"vc-glance-input vc-glance-reminder-custom" + (customInvalid && customValue ? " vc-glance-input-error" : "")}
                                type="text"
                                inputMode="numeric"
                                placeholder="HH:MM:SS"
                                maxLength={11}
                                value={customValue}
                                onChange={e => setCustomValue(e.target.value.replace(/[^\d:]/g, ""))}
                                onKeyDown={e => { if (e.key === "Enter") submit(); }}
                                aria-label="Custom duration, hours minutes seconds"
                            />
                        )}
                        <button
                            className="vc-glance-button vc-glance-button-brand"
                            disabled={text.trim().length === 0 || customInvalid}
                            onClick={submit}
                        >
                            Add
                        </button>
                    </div>
                    {preset === "custom" && (
                        <span className="vc-glance-hint">
                            Countdown from now - e.g. <strong>00:15:00</strong> (15 min), <strong>1:30:00</strong> (1½ h), <strong>90:00</strong> (90 min).
                        </span>
                    )}
                </div>

                {sorted.length === 0
                    ? <div className="vc-glance-empty">Nothing to remember (yet). Add one above - timed reminders light this card up when they fire.</div>
                    : (
                        <div className="vc-glance-row-list">
                            {sorted.map(reminder => (
                                <ReminderRow key={reminder.id} reminder={reminder} now={now} />
                            ))}
                        </div>
                    )
                }
            </div>
        </WidgetCard>
    );
}
