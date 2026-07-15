/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";

import { WidgetCard } from "../WidgetCard";

interface HeapInfo {
    usedMB: number;
    limitMB: number;
}

// Chromium-only, but Discord's renderer is always Chromium
function readHeap(): HeapInfo | null {
    const { memory } = performance as any;
    if (typeof memory?.usedJSHeapSize !== "number") return null;
    return {
        usedMB: memory.usedJSHeapSize / 1048576,
        limitMB: memory.jsHeapSizeLimit / 1048576
    };
}

/**
 * Renderer-side metrics only: JS heap and event-loop lag. Real process-wide
 * CPU/RAM stats aren't exposed to Discord's renderer, and showing made-up
 * numbers would be worse than showing fewer, honest ones.
 */
export function ClientPerfWidget() {
    const [heap, setHeap] = React.useState<HeapInfo | null>(readHeap);
    const [lagMs, setLagMs] = React.useState(0);

    React.useEffect(() => {
        // Event-loop lag: how much later than scheduled the interval fires.
        // A rolling average over the last 8 samples keeps it stable.
        const samples: number[] = [];
        let expected = performance.now() + 500;

        const id = setInterval(() => {
            const drift = Math.max(0, performance.now() - expected);
            expected = performance.now() + 500;

            samples.push(drift);
            if (samples.length > 8) samples.shift();
            setLagMs(samples.reduce((a, b) => a + b, 0) / samples.length);

            setHeap(readHeap());
        }, 500);

        return () => clearInterval(id);
    }, []);

    const heapPercent = heap ? Math.min(100, (heap.usedMB / heap.limitMB) * 100) : 0;
    const laggy = lagMs > 50;

    return (
        <WidgetCard id="client-perf">
            <div className="vc-glance-perf-rows">
                <div className="vc-glance-perf-row">
                    <span className="vc-glance-perf-label">Memory (JS heap)</span>
                    <span className="vc-glance-perf-value">
                        {heap ? `${heap.usedMB.toFixed(1)} MB` : "N/A"}
                    </span>
                </div>
                {heap && (
                    <div className="vc-glance-perf-bar">
                        <div className="vc-glance-perf-bar-fill" style={{ width: `${heapPercent.toFixed(1)}%` }} />
                    </div>
                )}
                <div className="vc-glance-perf-row">
                    <span className="vc-glance-perf-label">UI latency</span>
                    <span className={"vc-glance-perf-value" + (laggy ? " vc-glance-perf-warn" : "")}>
                        {lagMs.toFixed(1)} ms
                    </span>
                </div>
            </div>
        </WidgetCard>
    );
}
