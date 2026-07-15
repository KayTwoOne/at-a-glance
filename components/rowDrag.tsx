/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AccessibilityStore, React } from "@webpack/common";

/**
 * Click-and-drag reordering for rows INSIDE a widget (pinned friends, watched
 * servers) - the widget-card drag at a smaller scale, sharing its ghost/slot
 * look. Differences from the card drag, on purpose:
 *
 * - Starts from a plain press on the row itself, but only after the pointer
 *   moves past a small threshold - a plain click still clicks (open DM,
 *   collapse a server), and pressing a button inside the row never drags.
 * - Rows can be hidden from render (offline friends): the commit merges the
 *   new on-screen order back into the FULL id list, keeping hidden ids in
 *   their old positions, so nothing is lost and the order persists correctly.
 * - The widget-card drag only ever starts from the grip in the card HEADER,
 *   so a row drag in the body can never be misread as dragging the module.
 */

export interface RowDragState {
    id: string;
    width: number;
    height: number;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
    /** Insertion index among the RENDERED rows (dragged row excluded) */
    overIndex: number;
}

const DRAG_THRESHOLD_PX = 6;

/** New full order: visible ids take their new order, hidden ids keep their slots */
function mergeReorder(fullIds: string[], visibleIds: Set<string>, visibleNew: string[]): string[] {
    const queue = [...visibleNew];
    return fullIds.map(id => (visibleIds.has(id) ? queue.shift()! : id));
}

export function useRowDrag({ ids, containerRef, mode, onCommit }: {
    /** FULL persisted id list (may include ids that aren't currently rendered) */
    ids: string[];
    /** The element containing the rows (each row carries data-glance-row) */
    containerRef: React.RefObject<HTMLElement | null>;
    /** "list" = single column (y midpoint); "grid" = wrapping cells (reading order) */
    mode: "list" | "grid";
    onCommit(nextOrder: string[]): void;
}) {
    const [drag, setDrag] = React.useState<RowDragState | null>(null);
    const dragRef = React.useRef<RowDragState | null>(null);
    const idsRef = React.useRef(ids);
    idsRef.current = ids;
    const draggedRef = React.useRef(false);

    const beginPress = React.useCallback((id: string, e: React.PointerEvent) => {
        if (e.button !== 0 || dragRef.current) return;
        // Buttons/inputs inside the row keep their own press behaviour
        if ((e.target as HTMLElement).closest("button, input, a, textarea, [role=\"menuitem\"]")) return;
        const container = containerRef.current;
        const row = container?.querySelector<HTMLElement>(`[data-glance-row="${id}"]`);
        if (!container || !row) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = row.getBoundingClientRect();

        const renderedRows = () =>
            [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-glance-row]") ?? [])]
                .filter(el => el.dataset.glanceRow !== id);

        const computeOverIndex = (cx: number, cy: number) => {
            const rows = renderedRows();
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i].getBoundingClientRect();
                if (mode === "list") {
                    if (cy < r.top + r.height / 2) return i;
                } else {
                    // Reading order: above this cell's row, or same row left of centre
                    if (cy < r.top || (cy < r.bottom && cx < r.left + r.width / 2)) return i;
                }
            }
            return rows.length;
        };

        const onMove = (ev: PointerEvent) => {
            const { current } = dragRef;
            if (!current) {
                // Not dragging yet: wait for the threshold so plain clicks stay clicks
                if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
                draggedRef.current = true;
                const state: RowDragState = {
                    id,
                    width: rect.width,
                    height: rect.height,
                    x: ev.clientX,
                    y: ev.clientY,
                    grabX: startX - rect.left,
                    grabY: startY - rect.top,
                    overIndex: computeOverIndex(ev.clientX, ev.clientY)
                };
                dragRef.current = state;
                document.body.classList.add("vc-glance-dragging");
                setDrag(state);
                return;
            }
            const next = { ...current, x: ev.clientX, y: ev.clientY, overIndex: computeOverIndex(ev.clientX, ev.clientY) };
            dragRef.current = next;
            setDrag(next);
        };

        const finish = (commit: boolean) => {
            const { current } = dragRef;
            // Snapshot the on-screen order BEFORE clearing state re-renders it
            const visibleNow = renderedRows().map(el => el.dataset.glanceRow!);
            dragRef.current = null;
            document.body.classList.remove("vc-glance-dragging");
            setDrag(null);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("keydown", onKey, true);
            // The click that follows pointerup must be swallowed once after a drag
            setTimeout(() => { draggedRef.current = false; }, 0);

            if (commit && current) {
                const visibleNew = [...visibleNow];
                visibleNew.splice(Math.min(current.overIndex, visibleNew.length), 0, current.id);
                const visibleSet = new Set([...visibleNow, current.id]);
                onCommit(mergeReorder(idsRef.current, visibleSet, visibleNew));
            }
        };

        const onUp = () => finish(dragRef.current != null);
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape" && dragRef.current) {
                ev.preventDefault();
                ev.stopPropagation();
                finish(false);
            }
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("keydown", onKey, true);
    }, [containerRef, mode, onCommit]);

    /** True during the click that immediately follows a drag - swallow it */
    const wasDragged = React.useCallback(() => draggedRef.current, []);

    return { drag, beginPress, wasDragged };
}

/** The dashed outline marking where the row will land (same look as widgets) */
export function RowDropSlot({ drag }: { drag: RowDragState; }) {
    return <div className="vc-glance-drop-slot vc-glance-row-drop-slot" style={{ height: drag.height }} />;
}

/** The floating copy following the cursor (same look as widgets, smaller scale) */
export function RowDragGhost({ drag, children }: { drag: RowDragState; children: React.ReactNode; }) {
    const reduceMotion = AccessibilityStore.useReducedMotion;
    return (
        <div
            className={"vc-glance-drag-ghost vc-glance-row-ghost" + (reduceMotion ? " vc-glance-no-motion" : "")}
            style={{
                width: drag.width,
                left: drag.x - drag.grabX,
                top: drag.y - drag.grabY
            }}
        >
            {children}
        </div>
    );
}
