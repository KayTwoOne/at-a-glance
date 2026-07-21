/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, ReadStateStore, UserStore, useStateFromStores } from "@webpack/common";

import { triggeredReminderCount, useGlanceConfig } from "../data";
import { formatCombo } from "../hotkeys";
import { settings } from "../settings";
import { openChannelPopup } from "./ChannelPopup";
import { CheckIcon } from "./icons";
import { ackAllDms, ackChannel, dismissMention, markAllRead, useNotifications } from "./notifications";
import { dmIdentity } from "./widgets/Mentions";

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

/** One row in the notification panel: title + optional subtitle, dismiss on the right */
function NotifRow({ ariaLabel, title, subtitle, dismissLabel, onOpen, onDismiss }: {
    ariaLabel: string;
    title: string;
    subtitle?: string;
    dismissLabel: string;
    onOpen: () => void;
    onDismiss: () => void;
}) {
    return (
        <div
            className="vc-glance-row vc-glance-hero-notifs-row"
            role="button"
            tabIndex={0}
            aria-label={ariaLabel}
            onClick={onOpen}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                }
            }}
        >
            <div className="vc-glance-row-text">
                <span className="vc-glance-row-title">{title}</span>
                {subtitle && <span className="vc-glance-row-subtitle">{subtitle}</span>}
            </div>
            <div className="vc-glance-row-actions" onClick={e => e.stopPropagation()}>
                <button className="vc-glance-icon-button" aria-label={dismissLabel} onClick={onDismiss}>
                    <CheckIcon size={14} />
                </button>
            </div>
        </div>
    );
}

const NOTIFS_SHOWN = 8;

export function GlanceHeader({ onSearch }: { onSearch: () => void; }) {
    const now = useClock();
    const me = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { watchedChannels } = useGlanceConfig();
    const { commandPaletteHotkey: paletteHotkey } = settings.use(["commandPaletteHotkey"]);

    // Shared with the Inbox widget so the two can never disagree, and so
    // dismissal from here still works with that widget hidden.
    const { mentions, unreadDms, total: notifTotal } = useNotifications();

    const unreadChannels = useStateFromStores([ReadStateStore], () => {
        let count = 0;
        for (const channelId of watchedChannels) {
            if (ReadStateStore.hasUnread(channelId)) count++;
        }
        return count;
    }, [watchedChannels.join(",")]);

    const remindersDue = triggeredReminderCount(now.getTime());

    const name = me ? (me.globalName || me.username) : "";

    const time = now.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", hour12: false });
    const date = now.toLocaleDateString(void 0, { weekday: "long", month: "long", day: "numeric" });

    // Build a natural summary line from whatever actually needs attention
    const parts: string[] = [];
    if (mentions.length > 0) parts.push(`${mentions.length} ${mentions.length === 1 ? "mention" : "mentions"}`);
    if (unreadDms.length > 0) parts.push(`${unreadDms.length} unread ${unreadDms.length === 1 ? "DM" : "DMs"}`);
    if (unreadChannels > 0) parts.push(`${unreadChannels} unread ${unreadChannels === 1 ? "channel" : "channels"}`);
    if (remindersDue > 0) parts.push(`${remindersDue} ${remindersDue === 1 ? "reminder" : "reminders"} due`);

    const summary = parts.length > 0
        ? parts.join(" · ")
        : "You're all caught up.";

    const [panelOpen, setPanelOpen] = React.useState(false);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const summaryRef = React.useRef<HTMLButtonElement>(null);

    // Nothing left to dismiss - the panel would just be its empty footer
    React.useEffect(() => {
        if (panelOpen && notifTotal === 0) setPanelOpen(false);
    }, [panelOpen, notifTotal]);

    React.useEffect(() => {
        if (!panelOpen) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setPanelOpen(false);
        };
        // Capture phase, same guard Dropdown uses: runs before the summary
        // button's own onClick, so a click that reopens the panel never
        // races with this closing it again.
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (panelRef.current?.contains(target) || summaryRef.current?.contains(target)) return;
            setPanelOpen(false);
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("pointerdown", onPointerDown, true);
        };
    }, [panelOpen]);

    const markAllReadAndClose = () => {
        markAllRead(mentions);
        ackAllDms(unreadDms);
        setPanelOpen(false);
    };

    const shownMentions = mentions.slice(0, NOTIFS_SHOWN);
    const shownDms = unreadDms.slice(0, NOTIFS_SHOWN);

    return (
        <>
            <div className="vc-glance-hero">
                <div className="vc-glance-hero-aurora" aria-hidden />
                <div className="vc-glance-hero-content">
                    <div className="vc-glance-hero-text">
                        <h1 className="vc-glance-hero-greeting">
                            {greetingFor(now.getHours())}{name ? <>, <span className="vc-glance-hero-name">{name}</span></> : null}
                        </h1>
                        {notifTotal > 0 ? (
                            <button
                                ref={summaryRef}
                                className={"vc-glance-hero-summary" + (parts.length > 0 ? " vc-glance-hero-summary-active" : "")}
                                aria-expanded={panelOpen}
                                aria-haspopup="dialog"
                                onClick={() => setPanelOpen(o => !o)}
                            >
                                {summary}
                            </button>
                        ) : (
                            <p className={"vc-glance-hero-summary" + (parts.length > 0 ? " vc-glance-hero-summary-active" : "")}>
                                {summary}
                            </p>
                        )}
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

            {panelOpen && (
                <div className="vc-glance-hero-notifs" ref={panelRef} role="dialog" aria-label="Notifications">
                    {mentions.length > 0 && (
                        <div className="vc-glance-hero-notifs-section">
                            <div className="vc-glance-subcard-title">Mentions</div>
                            <div className="vc-glance-row-list">
                                {shownMentions.map((message: any) => {
                                    const authorName = message.author?.globalName || message.author?.username || "Unknown";
                                    return (
                                        <NotifRow
                                            key={message.id}
                                            ariaLabel={`Open mention from ${authorName}`}
                                            title={authorName}
                                            subtitle={message.content || "(no text content)"}
                                            dismissLabel="Dismiss mention"
                                            onOpen={() => openChannelPopup(message.channel_id)}
                                            onDismiss={() => dismissMention(message.id)}
                                        />
                                    );
                                })}
                            </div>
                            {mentions.length > NOTIFS_SHOWN && (
                                <div className="vc-glance-hero-notifs-more">and {mentions.length - NOTIFS_SHOWN} more</div>
                            )}
                        </div>
                    )}
                    {unreadDms.length > 0 && (
                        <div className="vc-glance-hero-notifs-section">
                            <div className="vc-glance-subcard-title">Unread DMs</div>
                            <div className="vc-glance-row-list">
                                {shownDms.map((channel: any) => {
                                    const { name: dmName } = dmIdentity(channel);
                                    return (
                                        <NotifRow
                                            key={channel.id}
                                            ariaLabel={`Open DM with ${dmName}`}
                                            title={dmName}
                                            dismissLabel="Mark as read"
                                            onOpen={() => openChannelPopup(channel.id)}
                                            onDismiss={() => ackChannel(channel.id)}
                                        />
                                    );
                                })}
                            </div>
                            {unreadDms.length > NOTIFS_SHOWN && (
                                <div className="vc-glance-hero-notifs-more">and {unreadDms.length - NOTIFS_SHOWN} more</div>
                            )}
                        </div>
                    )}
                    <div className="vc-glance-hero-notifs-foot">
                        <button className="vc-glance-link-button" onClick={markAllReadAndClose}>Mark all read</button>
                    </div>
                </div>
            )}
        </>
    );
}
