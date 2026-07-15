/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { ChannelStore, React, ReadStateStore, UserStore, useStateFromStores } from "@webpack/common";

import { triggeredReminderCount, useGlanceConfig } from "../data";
import { formatCombo } from "../hotkeys";
import { settings } from "../settings";

const RecentMentionsStore = findStoreLazy("RecentMentionsStore") as {
    getMentions(): any[] | null;
};

function useClock() {
    const [now, setNow] = React.useState(() => new Date());
    React.useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

function greetingFor(hour: number) {
    if (hour < 5) return "Still up";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

export function GlanceHeader({ onSearch }: { onSearch: () => void; }) {
    const now = useClock();
    const me = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { watchedChannels } = useGlanceConfig();
    const { commandPaletteHotkey: paletteHotkey } = settings.use(["commandPaletteHotkey"]);

    const mentionCount = useStateFromStores([RecentMentionsStore], () => RecentMentionsStore.getMentions()?.length ?? 0, []);

    const unreadChannels = useStateFromStores([ReadStateStore], () => {
        let count = 0;
        for (const channelId of watchedChannels) {
            if (ReadStateStore.hasUnread(channelId)) count++;
        }
        return count;
    }, [watchedChannels.join(",")]);

    // Every DM/group DM with unread messages, pinned friend or not - the whole
    // point of an at-a-glance greeting is to know what's actually waiting.
    const unreadDms = useStateFromStores([ReadStateStore, ChannelStore], () => {
        let count = 0;
        for (const channel of ChannelStore.getSortedPrivateChannels()) {
            if (ReadStateStore.hasUnread(channel.id)) count++;
        }
        return count;
    }, []);

    const remindersDue = triggeredReminderCount(now.getTime());

    const name = me ? (me.globalName || me.username) : "";

    const time = now.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
    const date = now.toLocaleDateString(void 0, { weekday: "long", month: "long", day: "numeric" });

    // Build a natural summary line from whatever actually needs attention
    const parts: string[] = [];
    if (mentionCount > 0) parts.push(`${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`);
    if (unreadDms > 0) parts.push(`${unreadDms} unread ${unreadDms === 1 ? "DM" : "DMs"}`);
    if (unreadChannels > 0) parts.push(`${unreadChannels} unread ${unreadChannels === 1 ? "channel" : "channels"}`);
    if (remindersDue > 0) parts.push(`${remindersDue} ${remindersDue === 1 ? "reminder" : "reminders"} due`);

    const summary = parts.length > 0
        ? parts.join(" · ")
        : "You're all caught up.";

    return (
        <div className="vc-glance-hero">
            <div className="vc-glance-hero-aurora" aria-hidden />
            <div className="vc-glance-hero-content">
                <div className="vc-glance-hero-text">
                    <h1 className="vc-glance-hero-greeting">
                        {greetingFor(now.getHours())}{name ? <>, <span className="vc-glance-hero-name">{name}</span></> : null}
                    </h1>
                    <p className={"vc-glance-hero-summary" + (parts.length > 0 ? " vc-glance-hero-summary-active" : "")}>
                        {summary}
                    </p>
                </div>
                <div className="vc-glance-hero-side">
                    <div className="vc-glance-hero-clock">
                        <span className="vc-glance-hero-time">{time}</span>
                        <span className="vc-glance-hero-date">{date}</span>
                    </div>
                    <button className="vc-glance-hero-search" onClick={onSearch}>
                        <span>Search</span>
                        {paletteHotkey && <kbd className="vc-glance-palette-kbd">{formatCombo(paletteHotkey)}</kbd>}
                    </button>
                </div>
            </div>
        </div>
    );
}
