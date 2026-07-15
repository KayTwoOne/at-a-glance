/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Message rendering for the channel popup: Discord's native message rows with
 * our grouping, reply/edit affordances and the NEW divider, plus a dependency-
 * free plain renderer as the fallback if Discord's internals shift.
 */

import { getUserSettingLazy } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import { findByPropsLazy, findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import {
    ContextMenuApi,
    FluxDispatcher,
    Menu,
    moment,
    Parser,
    PendingReplyStore,
    React,
    UserStore,
    useStateFromStores
} from "@webpack/common";

const logger = new Logger("AtAGlance");

// Native message renderer - same component MessageLinkEmbeds uses. Gives real
// markdown, embeds, attachments, reactions and edited tags for free.
const ChannelMessage = findComponentByCodeLazy("childrenExecutedCommand:", ".hideAccessories");
const SearchResultClasses = findCssClassesLazy("message", "searchResult");
const MessageDisplayCompact = getUserSettingLazy("textAndImages", "messageDisplayCompact")!;

// Discord's own clipboard helper (works in the desktop sandbox where the raw
// navigator.clipboard can be restricted)
const Clipboard = findByPropsLazy("copy", "SUPPORTS_COPY") as { copy(text: string): void; SUPPORTS_COPY: boolean; };

// Discord's message action creators - editMessage saves an edit server-side;
// getSendMessageOptionsForReply turns a pending reply into the send options
// (message_reference + allowed_mentions) so our own send attaches the reply.
export const MsgActions = findByPropsLazy("editMessage", "sendMessage") as {
    editMessage(channelId: string, messageId: string, edit: { content: string; }): Promise<unknown>;
    getSendMessageOptionsForReply?(reply: any): any;
};

// Discord groups consecutive same-author messages sent within ~5 minutes into
// one visual block (avatar/name shown once). We compute the same grouping and
// mark continuation rows so the CSS collapses the repeated avatar + header.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Start a reply - the same action Discord's reply button uses. The composer
 *  (the channel's real chat input) sends with the reference; our own reply bar
 *  reflects it (both read PendingReplyStore). */
function startReply(channel: any, message: any) {
    try {
        const meId = UserStore.getCurrentUser()?.id;
        FluxDispatcher.dispatch({
            type: "CREATE_PENDING_REPLY",
            channel,
            message,
            shouldMention: true,
            showMentionToggle: channel.guild_id != null && message.author?.id !== meId
        });
    } catch (e) {
        logger.error("Failed to start reply", e);
    }
}

function cancelReply(channelId: string) {
    try {
        FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
    } catch (e) {
        logger.error("Failed to cancel reply", e);
    }
}

function copyText(text: string) {
    try {
        if (Clipboard?.SUPPORTS_COPY) Clipboard.copy(text);
        else void navigator.clipboard?.writeText(text);
    } catch (e) {
        logger.error("Failed to copy", e);
    }
}

function MessageMenu({ channel, message, isOwn, onEdit }: { channel: any; message: any; isOwn: boolean; onEdit: () => void; }) {
    const hasText = typeof message.content === "string" && message.content.length > 0;
    return (
        <Menu.Menu navId="vc-glance-message-menu" onClose={ContextMenuApi.closeContextMenu} aria-label="Message options">
            <Menu.MenuItem id="vc-glance-msg-reply" label="Reply" action={() => startReply(channel, message)} />
            {isOwn && hasText && <Menu.MenuItem id="vc-glance-msg-edit" label="Edit Message" action={onEdit} />}
            {hasText && <Menu.MenuItem id="vc-glance-msg-copy" label="Copy Text" action={() => copyText(message.content)} />}
        </Menu.Menu>
    );
}

/** Our own inline editor - the native inline editor needs the full message-list
 *  context the popup doesn't provide, so we render a controlled box and save via
 *  Discord's editMessage action. Reliable, with a clear "editing" indicator. */
function MessageEditor({ channel, message, onDone }: { channel: any; message: any; onDone: () => void; }) {
    const [value, setValue] = React.useState<string>(message.content ?? "");
    const [saving, setSaving] = React.useState(false);
    const ref = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, []);

    const save = async () => {
        if (saving) return;
        const content = value.trim();
        if (content === (message.content ?? "").trim()) { onDone(); return; }
        if (content.length === 0) { onDone(); return; }
        setSaving(true);
        try {
            await MsgActions.editMessage(channel.id, message.id, { content });
            onDone();
        } catch (e) {
            logger.error("Failed to edit message", e);
            setSaving(false);
        }
    };

    return (
        <div className="vc-glance-msg-edit">
            <div className="vc-glance-msg-edit-badge">Editing message</div>
            <textarea
                ref={ref}
                className="vc-glance-composer-input vc-glance-msg-edit-input"
                rows={1}
                value={value}
                disabled={saving}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        onDone();
                    } else if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        save();
                    }
                }}
            />
            <div className="vc-glance-msg-edit-hint">
                escape to <button className="vc-glance-linkbtn" onClick={onDone}>cancel</button>
                {" • "}enter to <button className="vc-glance-linkbtn" onClick={save}>save</button>
            </div>
        </div>
    );
}

/** One native message row. Right-click for the menu, double-click to reply (or
 *  edit your own). Continuation rows get a class the CSS uses to hide the
 *  repeated avatar/name so same-author bursts read as one block. */
function MessageRow({ message, channel, groupId, compact, isOwn, isContinuation, isEditing, onEdit, onStopEdit }: {
    message: any; channel: any; groupId: string; compact: boolean; isOwn: boolean;
    isContinuation: boolean; isEditing: boolean; onEdit: () => void; onStopEdit: () => void;
}) {
    if (isEditing) {
        return (
            <div className="vc-glance-native-msg vc-glance-msg-editing">
                <MessageEditor channel={channel} message={message} onDone={onStopEdit} />
            </div>
        );
    }

    const openMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        ContextMenuApi.openContextMenu(e, () => (
            <MessageMenu channel={channel} message={message} isOwn={isOwn} onEdit={onEdit} />
        ));
    };

    const canEditOwn = isOwn && typeof message.content === "string" && message.content.length > 0;

    return (
        <div
            className={"vc-glance-native-msg " + (SearchResultClasses.message ?? "")
                + (isContinuation ? " vc-glance-msg-cont" : " vc-glance-msg-start")}
            onContextMenu={openMenu}
            onDoubleClick={() => (canEditOwn ? onEdit() : startReply(channel, message))}
        >
            <ChannelMessage
                id={`vc-glance-msg-${message.id}`}
                message={message}
                channel={channel}
                groupId={groupId}
                subscribeToComponentDispatch={true}
                compact={compact}
            />
        </div>
    );
}

export function NativeMessageList({ messages, channel, editingId, firstUnreadId, onEdit, onStopEdit }: {
    messages: any[]; channel: any; editingId: string | null; firstUnreadId: string | null;
    onEdit: (id: string) => void; onStopEdit: () => void;
}) {
    const compact = MessageDisplayCompact.useSetting();
    const myId = UserStore.getCurrentUser()?.id;

    // Walk the list assigning group ids: a new group starts on author change, a
    // >5min gap, a reply, or a non-standard (system) message.
    let groupId = "";
    let lastAuthorId: string | null = null;
    let lastTs = 0;

    const rows: React.ReactNode[] = [];
    for (const message of messages) {
        const ts = new Date(message.timestamp).getTime();
        const isPlainMessage = message.type === 0 || message.type === 19;
        const startsGroup =
            message.author?.id !== lastAuthorId
            || ts - lastTs > GROUP_WINDOW_MS
            || message.messageReference != null
            || !isPlainMessage;
        if (startsGroup) groupId = message.id;
        lastAuthorId = message.author?.id ?? null;
        lastTs = ts;

        // Same marker the real client draws at your last-read point
        if (message.id === firstUnreadId) {
            rows.push(
                <div key="vc-glance-new" className="vc-glance-new-divider" aria-label="New messages">
                    <span>NEW</span>
                </div>
            );
        }

        rows.push(
            <MessageRow
                key={message.id}
                message={message}
                channel={channel}
                groupId={groupId}
                compact={compact}
                isOwn={message.author?.id === myId}
                isContinuation={!startsGroup && message.id !== firstUnreadId}
                isEditing={editingId === message.id}
                onEdit={() => onEdit(message.id)}
                onStopEdit={onStopEdit}
            />
        );
    }
    return <>{rows}</>;
}

/** "Replying to X" bar shown above the composer, driven by PendingReplyStore so
 *  it stays in sync with Discord (created by our Reply action, cleared on send). */
export function ReplyBar({ channelId }: { channelId: string; }) {
    const reply = useStateFromStores([PendingReplyStore], () => PendingReplyStore.getPendingReply(channelId), [channelId]);
    if (!reply?.message) return null;
    const { author } = reply.message;
    const name = author?.globalName || author?.username || "message";
    return (
        <div className="vc-glance-reply-bar">
            <span className="vc-glance-reply-bar-text">Replying to <strong>{name}</strong></span>
            <button
                className="vc-glance-icon-button vc-glance-reply-bar-cancel"
                aria-label="Cancel reply"
                onClick={() => cancelReply(channelId)}
            >
                ✕
            </button>
        </div>
    );
}

/* ========== fallback (plain) message rendering ========== */

function formatTimestamp(timestamp: unknown) {
    try {
        return moment(timestamp as string).calendar();
    } catch {
        return "";
    }
}

const IMAGE_HOSTS = ["https://cdn.discordapp.com/", "https://media.discordapp.net/"];

function MessageAttachments({ attachments }: { attachments: any[]; }) {
    if (!Array.isArray(attachments) || attachments.length === 0) return null;

    return (
        <div className="vc-glance-msg-attachments">
            {attachments.slice(0, 4).map((attachment, i) => {
                const url: unknown = attachment?.proxy_url ?? attachment?.url;
                const isImage = typeof attachment?.content_type === "string"
                    && attachment.content_type.startsWith("image/")
                    && typeof url === "string"
                    && IMAGE_HOSTS.some(host => url.startsWith(host));

                return isImage
                    ? <img key={i} className="vc-glance-msg-image" src={url as string} alt="" />
                    : <span key={i} className="vc-glance-msg-file">📎 {String(attachment?.filename ?? "attachment")}</span>;
            })}
        </div>
    );
}

function PlainMessageItem({ message, showHeader }: { message: any; showHeader: boolean; }) {
    const { author } = message;
    const name = author?.globalName || author?.username || "Unknown";

    return (
        <div className={"vc-glance-msg" + (showHeader ? " vc-glance-msg-grouped" : "")}>
            {showHeader && (
                <div className="vc-glance-msg-header">
                    <img
                        className="vc-glance-msg-avatar"
                        src={author?.getAvatarURL?.(void 0, 40, false)}
                        alt=""
                        draggable={false}
                    />
                    <span className="vc-glance-msg-author">{name}</span>
                    <span className="vc-glance-msg-time">{formatTimestamp(message.timestamp)}</span>
                </div>
            )}
            <div className="vc-glance-msg-content">
                {message.content
                    ? Parser.parse(message.content, true, { channelId: message.channel_id })
                    : null}
                <MessageAttachments attachments={message.attachments} />
            </div>
        </div>
    );
}

export function PlainMessageList({ messages }: { messages: any[]; }) {
    let lastAuthorId: string | null = null;
    let lastTimestamp = 0;

    return (
        <>
            {messages.map((message: any) => {
                const ts = new Date(message.timestamp).getTime();
                const showHeader = message.author?.id !== lastAuthorId || ts - lastTimestamp > GROUP_WINDOW_MS;
                lastAuthorId = message.author?.id ?? null;
                lastTimestamp = ts;
                return <PlainMessageItem key={message.id} message={message} showHeader={showHeader} />;
            })}
        </>
    );
}
