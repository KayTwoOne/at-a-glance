/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { findCssClassesLazy } from "@webpack";
import { ChannelStore, React, ReactDOM, ReadStateStore, useStateFromStores } from "@webpack/common";

import { triggeredReminderCount, useGlanceConfig } from "../data";
import { settings } from "../settings";
import { ChannelPopupHost } from "./ChannelPopup";
import { openGlance, useGlanceOpen } from "./GlanceLayer";
import { DashboardIcon } from "./icons";

// Discord's own sidebar row CSS module: `channel` provides the li metrics
// (margin, max-width). The inner layout is deliberately NOT reused - the
// native `link` class uses justify-content:space-between, which breaks a
// simple icon+label row - so the pill is fully styled by the plugin using
// Discord's current design tokens instead.
const rowClasses = findCssClassesLazy("channel", "linkButton", "linkButtonIcon", "link");

function activate(e: React.KeyboardEvent | React.MouseEvent) {
    e.preventDefault();
    openGlance();
}

/** The sidebar tab rendered above the Friends row */
export function GlanceTab() {
    const { tabLabel } = settings.use(["tabLabel"]);
    const selected = useGlanceOpen();
    const { pinnedUsers, watchedChannels, reminders } = useGlanceConfig();

    // Fired reminders count toward the tab badge even with the view closed;
    // a slow tick keeps the count honest while timers cross their due time
    const [, forceTick] = React.useReducer(x => x + 1, 0);
    const hasPendingTimers = reminders.some(r => r.dueAt !== null);
    React.useEffect(() => {
        if (!hasPendingTimers) return;
        const id = setInterval(forceTick, 30_000);
        return () => clearInterval(id);
    }, [hasPendingTimers]);
    const remindersDue = triggeredReminderCount();

    // Aggregate across everything pinned: mention count as a red badge,
    // plain unreads as a white dot - mirroring native sidebar signals
    const { mentions, hasUnread } = useStateFromStores([ReadStateStore, ChannelStore], () => {
        let mentions = 0;
        let hasUnread = false;

        for (const channelId of watchedChannels) {
            mentions += ReadStateStore.getMentionCount(channelId);
            if (!hasUnread && !ChannelStore.getChannel(channelId)?.isVocal() && ReadStateStore.hasUnread(channelId)) {
                hasUnread = true;
            }
        }
        for (const userId of pinnedUsers) {
            const dmChannelId = ChannelStore.getDMFromUserId(userId);
            if (dmChannelId) mentions += ReadStateStore.getMentionCount(dmChannelId);
        }
        return { mentions, hasUnread };
    }, [pinnedUsers.join(","), watchedChannels.join(",")]);

    return (
        <li className={classes("vc-glance-tab", rowClasses.channel)}>
            <div
                className={"vc-glance-tab-pill" + (selected ? " vc-glance-tab-selected" : "")}
                role="button"
                tabIndex={0}
                aria-label={tabLabel || "At a glance"}
                onClick={activate}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") activate(e);
                }}
            >
                <DashboardIcon className="vc-glance-tab-icon" size={20} />
                <div className="vc-glance-tab-label">{tabLabel || "At a glance"}</div>
                {mentions + remindersDue > 0
                    ? <span className="vc-glance-badge vc-glance-tab-badge">{mentions + remindersDue > 99 ? "99+" : mentions + remindersDue}</span>
                    : hasUnread && <span className="vc-glance-unread-dot vc-glance-tab-badge" />
                }
            </div>

            {/* The channel popup is hosted HERE - inside Discord's React tree -
                not in the overlay's own root. Portals keep React context, so
                Discord's expression picker and autocomplete get the app-level
                providers they need (they render nothing without them, which is
                exactly what broke when the popup moved off Discord's modal
                system). The portal to body keeps the fixed backdrop's
                positioning independent of the sidebar's DOM. */}
            <ErrorBoundary noop>
                {ReactDOM.createPortal(<ChannelPopupHost />, document.body)}
            </ErrorBoundary>
        </li>
    );
}
