/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { ContextMenuApi, Menu, Tooltip } from "@webpack/common";

import {
    isWidgetCollapsed,
    moveWidget,
    toggleWidgetCollapsed,
    toggleWidgetHidden,
    useGlanceConfig,
    WIDGET_META,
    WidgetId
} from "../data";
import { useWidgetDrag } from "./GlanceLayer";
import { ChevronIcon, DotsIcon, GripIcon } from "./icons";

interface WidgetCardProps {
    id: WidgetId;
    /** Optional element(s) rendered at the right edge of the header */
    actions?: React.ReactNode;
    /** When > 0: red badge on the header + a subtle shine sweep, even collapsed */
    attention?: number;
    children: React.ReactNode;
}

function openCardMenu(e: React.MouseEvent, id: WidgetId) {
    e.preventDefault();
    e.stopPropagation();
    ContextMenuApi.openContextMenu(e, () => (
        <Menu.Menu
            navId="vc-glance-widget-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Widget options"
        >
            <Menu.MenuItem id="vc-glance-widget-up" label="Move up" action={() => moveWidget(id, -1)} />
            <Menu.MenuItem id="vc-glance-widget-down" label="Move down" action={() => moveWidget(id, 1)} />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-glance-widget-hide"
                label="Hide widget"
                color="danger"
                action={() => toggleWidgetHidden(id)}
            />
        </Menu.Menu>
    ));
}

/** Shared shell for all widgets: card surface, collapsible header, drag handle, error isolation */
export function WidgetCard({ id, actions, attention = 0, children }: WidgetCardProps) {
    // Subscribing here keeps collapse state live without prop-drilling
    useGlanceConfig();
    const drag = useWidgetDrag();
    const collapsed = isWidgetCollapsed(id);
    const label = WIDGET_META.find(w => w.id === id)?.label ?? id;

    return (
        <section
            className={
                "vc-glance-card"
                + (collapsed ? " vc-glance-card-collapsed" : "")
                + (attention > 0 ? " vc-glance-card-attention" : "")
            }
            onContextMenu={e => openCardMenu(e, id)}
        >
            <header className="vc-glance-card-header">
                <button
                    className="vc-glance-card-collapse"
                    aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
                    aria-expanded={!collapsed}
                    onClick={() => toggleWidgetCollapsed(id)}
                >
                    <ChevronIcon className="vc-glance-chevron" size={16} />
                </button>
                {drag && (
                    <Tooltip text="Drag to rearrange">
                        {props => (
                            <div
                                {...props}
                                className="vc-glance-card-grip"
                                onPointerDown={e => drag.beginDrag(id, e)}
                            >
                                <GripIcon size={14} />
                            </div>
                        )}
                    </Tooltip>
                )}
                <h2 className="vc-glance-card-title" onClick={() => toggleWidgetCollapsed(id)}>
                    {label}
                </h2>
                {attention > 0 && (
                    <span className="vc-glance-badge">{attention > 99 ? "99+" : attention}</span>
                )}
                {actions && !collapsed && <div className="vc-glance-card-actions">{actions}</div>}
                <Tooltip text="Widget options">
                    {props => (
                        <button
                            {...props}
                            className="vc-glance-icon-button"
                            onClick={e => openCardMenu(e, id)}
                        >
                            <DotsIcon size={16} />
                        </button>
                    )}
                </Tooltip>
            </header>
            {!collapsed && (
                <div className="vc-glance-card-body">
                    <ErrorBoundary>
                        {children}
                    </ErrorBoundary>
                </div>
            )}
        </section>
    );
}
