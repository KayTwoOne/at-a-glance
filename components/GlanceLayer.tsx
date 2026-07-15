/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import {
    AccessibilityStore,
    ContextMenuApi,
    createRoot,
    FluxDispatcher,
    Menu,
    NavigationRouter,
    React,
    showToast,
    Toasts,
    Tooltip
} from "@webpack/common";

import {
    setGroupOrder,
    toggleWidgetHidden,
    useGlanceConfig,
    useOrderedWidgets,
    WIDGET_META,
    WidgetGroup,
    WidgetId
} from "../data";
import { matchesKeyboardCombo } from "../hotkeys";
import { settings } from "../settings";
import { useAppearance, useOnLightTheme } from "./appearance";
import { closeChannelPopup, isChannelPopupOpen } from "./ChannelPopup";
import { CommandPalette } from "./CommandPalette";
import { openCustomizePanel } from "./CustomizePanel";
import { GlanceHeader } from "./GlanceHeader";
import { DashboardIcon, PaletteIcon, PlusIcon } from "./icons";
import { RailUserStrip } from "./RailUserStrip";
import { BookmarksWidget } from "./widgets/Bookmarks";
import { ClientPerfWidget } from "./widgets/ClientPerf";
import { EventsWidget } from "./widgets/Events";
import { IntegrationsWidget } from "./widgets/Integrations";
import { MentionsWidget } from "./widgets/Mentions";
import { OrionWidget } from "./widgets/Orion";
import { PinnedFriendsWidget } from "./widgets/PinnedFriends";
import { QuickAccessWidget } from "./widgets/QuickAccess";
import { QuickToolsWidget } from "./widgets/QuickTools";
import { RemindersWidget } from "./widgets/Reminders";

const logger = new Logger("AtAGlance");

const WIDGET_RENDERERS: Record<WidgetId, () => React.ReactNode> = {
    "pinned-friends": () => <PinnedFriendsWidget />,
    "quick-access": () => <QuickAccessWidget />,
    "mentions": () => <MentionsWidget />,
    "bookmarks": () => <BookmarksWidget />,
    "events": () => <EventsWidget />,
    "quick-tools": () => <QuickToolsWidget />,
    "reminders": () => <RemindersWidget />,
    "integrations": () => <IntegrationsWidget />,
    "client-perf": () => <ClientPerfWidget />,
    "orion": () => <OrionWidget />
};

/* ========== open/close state ========== */

let layerOpen = false;
let openedAt = 0;
const openStateListeners = new Set<() => void>();

function setLayerOpen(open: boolean) {
    if (layerOpen === open) return;
    layerOpen = open;
    for (const listener of [...openStateListeners]) {
        try {
            listener();
        } catch { }
    }
}

export function useGlanceOpen() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        openStateListeners.add(forceUpdate);
        return () => void openStateListeners.delete(forceUpdate);
    }, []);
    return layerOpen;
}

/* ========== native chrome handling ========== */

/**
 * Finds Discord's draggable top chrome (OS titlebar strip and, in the visual
 * refresh, the app toolbar row below it). The overlay starts underneath them
 * so window dragging and the min/max/close buttons keep working.
 */
function measureTopChrome(): { top: number; bars: HTMLElement[]; } {
    const bars: HTMLElement[] = [];
    let top = 0;
    try {
        for (const y of [6, 26, 44, 64]) {
            for (const el of document.elementsFromPoint(window.innerWidth * 0.6, y)) {
                const html = el as HTMLElement;
                if (html.closest(".vc-glance-overlay")) continue;
                if (bars.includes(html)) continue;
                if (getComputedStyle(html).getPropertyValue("-webkit-app-region") === "drag") {
                    bars.push(html);
                    top = Math.max(top, html.getBoundingClientRect().bottom);
                }
            }
        }
    } catch (e) {
        logger.error("Failed to measure top chrome", e);
    }
    return { top, bars };
}

let hiddenToolbar: HTMLElement | null = null;

/**
 * Blanks the app toolbar's channel-specific contents (the ".kay in a DM" info)
 * while the overlay is open, keeping the bar itself for styling and window
 * dragging. Only done when the OS titlebar (window buttons) is a SEPARATE bar,
 * so window controls can never be hidden by accident.
 */
function coverToolbar(bars: HTMLElement[]) {
    if (bars.length < 2) return;
    const toolbar = bars.reduce((a, b) =>
        a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b
    );
    toolbar.setAttribute("data-vc-glance-chrome", "");
    hiddenToolbar = toolbar;
}

function uncoverToolbar() {
    hiddenToolbar?.removeAttribute("data-vc-glance-chrome");
    hiddenToolbar = null;
}

/* ========== mount / unmount ========== */

let overlayRoot: ReturnType<typeof createRoot> | null = null;
let overlayContainer: HTMLDivElement | null = null;

export function openGlance() {
    if (layerOpen) return;
    try {
        // Land on the neutral DM home underneath, so no user-DM state lingers
        // anywhere in the chrome - this view is its own thing
        try {
            NavigationRouter.transitionTo("/channels/@me");
        } catch { }

        const { top, bars } = measureTopChrome();
        coverToolbar(bars);

        overlayContainer = document.createElement("div");
        overlayContainer.className = "vc-glance-overlay";
        overlayContainer.style.top = `${top}px`;
        (document.getElementById("app-mount") ?? document.body).appendChild(overlayContainer);
        overlayRoot = createRoot(overlayContainer);
        overlayRoot.render(<SafeGlanceLayer />);
        // Lets CSS hide Discord's own bottom-left user panel (and its game
        // activity chip) while our rail strip replaces it
        document.body.setAttribute("data-vc-glance-open", "");
        openedAt = Date.now();
        setLayerOpen(true);
    } catch (e) {
        logger.error("Failed to mount overlay", e);
        showToast("At a glance could not open - Discord internals may have changed.", Toasts.Type.FAILURE);
        uncoverToolbar();
        overlayContainer?.remove();
        overlayContainer = null;
        overlayRoot = null;
    }
}

export function closeGlance() {
    if (!layerOpen) return;
    setLayerOpen(false);
    uncoverToolbar();
    document.body.removeAttribute("data-vc-glance-open");

    const root = overlayRoot;
    const container = overlayContainer;
    overlayRoot = null;
    overlayContainer = null;

    // Deferred so unmounting never happens synchronously from inside one of
    // the overlay's own event handlers
    setTimeout(() => {
        try {
            root?.unmount();
        } catch (e) {
            logger.error("Failed to unmount overlay", e);
        }
        container?.remove();
    }, 0);
}

/** Called from the plugin's stop() so a disabled plugin never leaves a dead overlay behind */
export function closeGlanceIfOpen() {
    if (layerOpen) closeGlance();
}

/* ========== add widget menu ========== */

function openAddWidgetMenu(e: React.MouseEvent, hiddenWidgets: WidgetId[]) {
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu
            navId="vc-glance-add-widget"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Toggle widgets"
        >
            {WIDGET_META.map(w => (
                <Menu.MenuCheckboxItem
                    key={w.id}
                    id={`vc-glance-toggle-${w.id}`}
                    label={w.label}
                    checked={!hiddenWidgets.includes(w.id)}
                    action={() => toggleWidgetHidden(w.id)}
                />
            ))}
        </Menu.Menu>
    ));
}

/* ========== drag & drop ========== */

interface DragState {
    id: WidgetId;
    width: number;
    height: number;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
    overIndex: number;
}

interface DragController {
    beginDrag(id: WidgetId, e: React.PointerEvent): void;
}

// Created on first use, NEVER at module scope: `React` from @webpack/common
// is a lazy proxy, and touching it while the bundle is still evaluating
// (before Discord's webpack exists) throws and kills the whole renderer.
let dragContext: React.Context<DragController | null> | undefined;

function getDragContext() {
    return dragContext ??= React.createContext<DragController | null>(null);
}

export function useWidgetDrag() {
    return React.useContext(getDragContext());
}

let widgetDragActive = false;

function WidgetColumn({ group, title }: { group: WidgetGroup; title: string; }) {
    const widgets = useOrderedWidgets(group);
    const [drag, setDrag] = React.useState<DragState | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const dragRef = React.useRef<DragState | null>(null);
    const widgetsRef = React.useRef(widgets);
    widgetsRef.current = widgets;

    const controller = React.useMemo<DragController>(() => ({
        beginDrag(id, e) {
            if (e.button !== 0 || dragRef.current) return;
            const card = containerRef.current?.querySelector<HTMLElement>(`[data-glance-widget="${id}"]`);
            if (!card) return;

            e.preventDefault();
            const rect = card.getBoundingClientRect();
            const state: DragState = {
                id,
                width: rect.width,
                height: rect.height,
                x: e.clientX,
                y: e.clientY,
                grabX: e.clientX - rect.left,
                grabY: e.clientY - rect.top,
                overIndex: Math.max(0, widgetsRef.current.indexOf(id))
            };
            dragRef.current = state;
            widgetDragActive = true;
            document.body.classList.add("vc-glance-dragging");
            setDrag(state);

            const computeOverIndex = (clientY: number) => {
                const cards = [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-glance-widget]") ?? [])]
                    .filter(el => el.dataset.glanceWidget !== state.id);
                for (let i = 0; i < cards.length; i++) {
                    const r = cards[i].getBoundingClientRect();
                    if (clientY < r.top + r.height / 2) return i;
                }
                return cards.length;
            };

            const onMove = (ev: PointerEvent) => {
                const { current } = dragRef;
                if (!current) return;
                const next = { ...current, x: ev.clientX, y: ev.clientY, overIndex: computeOverIndex(ev.clientY) };
                dragRef.current = next;
                setDrag(next);
            };

            const finish = (commit: boolean) => {
                const { current } = dragRef;
                dragRef.current = null;
                widgetDragActive = false;
                document.body.classList.remove("vc-glance-dragging");
                setDrag(null);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("keydown", onKey, true);

                if (commit && current) {
                    const rest = widgetsRef.current.filter(w => w !== current.id);
                    rest.splice(Math.min(current.overIndex, rest.length), 0, current.id);
                    setGroupOrder(group, rest);
                }
            };

            const onUp = () => finish(true);
            const onKey = (ev: KeyboardEvent) => {
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finish(false);
                }
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("keydown", onKey, true);
        }
    }), [group]);

    const reduceMotion = AccessibilityStore.useReducedMotion;
    const visible = drag ? widgets.filter(id => id !== drag.id) : widgets;

    const rendered: React.ReactNode[] = [];
    visible.forEach((id, i) => {
        if (drag && i === drag.overIndex) {
            rendered.push(
                <div
                    key="vc-glance-drop-slot"
                    className="vc-glance-drop-slot"
                    style={{ height: drag.height }}
                />
            );
        }
        rendered.push(
            <div key={id} data-glance-widget={id} className="vc-glance-widget-slot">
                {WIDGET_RENDERERS[id]()}
            </div>
        );
    });
    if (drag && drag.overIndex >= visible.length) {
        rendered.push(
            <div
                key="vc-glance-drop-slot"
                className="vc-glance-drop-slot"
                style={{ height: drag.height }}
            />
        );
    }

    const DragContext = getDragContext();

    return (
        <DragContext.Provider value={controller}>
            <div className={`vc-glance-column vc-glance-column-${group}`} ref={containerRef}>
                <h3 className="vc-glance-column-label">{title}</h3>
                {widgets.length === 0
                    ? <div className="vc-glance-empty">Nothing here - re-add widgets via <strong>Add Widget</strong>.</div>
                    : rendered
                }
            </div>

            {drag && (
                <div
                    className={"vc-glance-drag-ghost" + (reduceMotion ? " vc-glance-no-motion" : "")}
                    style={{
                        width: drag.width,
                        left: drag.x - drag.grabX,
                        top: drag.y - drag.grabY
                    }}
                >
                    {WIDGET_RENDERERS[drag.id]()}
                </div>
            )}
        </DragContext.Provider>
    );
}

/* ========== the layer ========== */

function GlanceLayer() {
    const { tabLabel } = settings.use(["tabLabel"]);
    const { hiddenWidgets } = useGlanceConfig();
    const { materialClass, style: appearanceStyle } = useAppearance();
    const onLightTheme = useOnLightTheme();
    const [paletteOpen, setPaletteOpen] = React.useState(false);
    const paletteOpenRef = React.useRef(false);
    paletteOpenRef.current = paletteOpen;

    // Palette hotkey runs in the CAPTURE phase so it fires before - and
    // stops - Discord's own shortcut (e.g. its Ctrl+K quick switcher). The
    // combo is user-configurable; default Shift+Space avoids any collision.
    React.useEffect(() => {
        function onPaletteKey(e: KeyboardEvent) {
            const combo = settings.store.commandPaletteHotkey?.trim();
            if (!combo || !matchesKeyboardCombo(e, combo)) return;

            // Don't hijack a plain (no ctrl/alt/meta) combo while the user is
            // typing - e.g. Shift+Space must still type a space in a text box,
            // including the palette's own search input
            if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                const target = e.target as HTMLElement | null;
                if (target?.closest?.("input, textarea, [contenteditable=\"true\"]")) return;
            }

            e.preventDefault();
            e.stopPropagation();
            setPaletteOpen(true);
        }
        window.addEventListener("keydown", onPaletteKey, true);
        return () => window.removeEventListener("keydown", onPaletteKey, true);
    }, []);

    React.useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            // Bubble phase + guards: modals, menus, the channel popup, the
            // palette and an active widget drag all get first crack at Escape
            if (e.key === "Escape" && !e.defaultPrevented && !isChannelPopupOpen() && !widgetDragActive && !paletteOpenRef.current) {
                closeGlance();
            }
        }

        // Navigating anywhere (clicking a server in the still-interactive
        // rail, a mention, etc.) dismisses the view like a normal page.
        // Grace period swallows the CHANNEL_SELECT our own open triggers.
        function onChannelSelect(event: any) {
            if (event?.channelId && Date.now() - openedAt > 800) closeGlance();
        }

        // The home / Direct-Messages button in the guild rail navigates to
        // /channels/@me - where we already are - so it fires no CHANNEL_SELECT
        // and the overlay would just sit there. Close on it (and any explicit
        // home/Friends link) so it behaves like leaving a page. Capture phase +
        // a tick's delay so Discord's own navigation still runs and lands you
        // back on Friends. HOME_SELECTOR stays broad on purpose (Discord's ids
        // churn): the guild-nav home item, or any anchor straight to @me.
        function onNavClick(e: MouseEvent) {
            if (Date.now() - openedAt < 400) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest?.('[data-list-item-id="guildsnav___home"], a[href="/channels/@me"], a[href="/channels/@me/"]')) {
                closeGlance();
            }
        }

        function onResize() {
            if (overlayContainer) overlayContainer.style.top = `${measureTopChrome().top}px`;
        }

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", onResize);
        window.addEventListener("click", onNavClick, true);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("click", onNavClick, true);
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
            // Covers the overlay being removed by any path other than closeGlance()
            setLayerOpen(false);
            uncoverToolbar();
            document.body.removeAttribute("data-vc-glance-open");
            // Don't let a still-open popup auto-reappear next time we open
            closeChannelPopup();
        };
    }, []);

    return (
        <div
            className={"vc-glance-layer" + materialClass + (onLightTheme ? " vc-glance-on-light" : "")}
            style={appearanceStyle}
        >
            <div className="vc-glance-frame">
                {/* Native-style top bar; the title doubles as the way back out */}
                <header className="vc-glance-topbar">
                    <Tooltip text="Back to Discord">
                        {props => (
                            <button {...props} className="vc-glance-topbar-back" onClick={closeGlance}>
                                <DashboardIcon className="vc-glance-topbar-icon" size={20} />
                                <span className="vc-glance-topbar-title">{tabLabel || "At a glance"}</span>
                            </button>
                        )}
                    </Tooltip>
                    <div className="vc-glance-topbar-actions">
                        <button
                            className="vc-glance-button vc-glance-button-brand"
                            onClick={e => openAddWidgetMenu(e, hiddenWidgets)}
                        >
                            <PlusIcon size={16} />
                            Add Widget
                        </button>
                        <Tooltip text="Customization">
                            {props => (
                                <button
                                    {...props}
                                    className="vc-glance-icon-button"
                                    onClick={openCustomizePanel}
                                >
                                    <PaletteIcon size={18} />
                                </button>
                            )}
                        </Tooltip>
                        <button
                            className="vc-glance-icon-button vc-glance-topbar-close"
                            aria-label="Close (Esc)"
                            onClick={closeGlance}
                        >
                            ✕
                        </button>
                    </div>
                </header>

                <div className="vc-glance-scroll">
                    <ErrorBoundary noop>
                        <GlanceHeader onSearch={() => setPaletteOpen(true)} />
                    </ErrorBoundary>
                    <div className="vc-glance-workspace">
                        <WidgetColumn group="social" title="Social" />
                        <WidgetColumn group="tools" title="Tools & Utilities" />
                    </div>
                </div>
            </div>

            <ErrorBoundary noop>
                <RailUserStrip />
            </ErrorBoundary>

            {paletteOpen && (
                <ErrorBoundary noop>
                    <CommandPalette onClose={() => setPaletteOpen(false)} />
                </ErrorBoundary>
            )}

            {/* The channel popup host lives in GlanceTab (Discord's tree), not
                here: this layer is its own React root without Discord's context
                providers, and the expression picker/autocomplete need them. */}
        </div>
    );
}

const SafeGlanceLayer = ErrorBoundary.wrap(GlanceLayer);
