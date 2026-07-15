/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import { moment, React, showToast, Toasts } from "@webpack/common";

import { settings } from "../../settings";
import { Dropdown } from "../Dropdown";
import { useNow } from "../hooks";
import { WidgetCard } from "../WidgetCard";

// Discord's clipboard helper (the desktop sandbox can restrict the raw API)
const Clipboard = findByPropsLazy("copy", "SUPPORTS_COPY") as { copy(text: string): void; SUPPORTS_COPY: boolean; };

/**
 * A useState-like store whose value lives at module scope, so it SURVIVES the
 * component unmounting. Collapsing the Quick Tools card unmounts its body
 * (WidgetCard only renders children while expanded), which used to wipe every
 * tool back to zero; backing them with this keeps a running stopwatch/timer and
 * the calculator's state intact across collapse, page close, and reopen. Running
 * clocks are stored as absolute timestamps, so they keep advancing while hidden.
 */
function persistentState<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    const set = (next: T | ((prev: T) => T)) => {
        value = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
        for (const listener of listeners) listener();
    };
    const use = (): [T, typeof set] => {
        const [, force] = React.useReducer((x: number) => x + 1, 0);
        React.useEffect(() => {
            listeners.add(force);
            return () => void listeners.delete(force);
        }, []);
        return [value, set];
    };
    return { use };
}

/** Validates an IANA timezone name without throwing */
function isValidTimezone(tz: string) {
    try {
        Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function formatTime(now: number, timeZone?: string) {
    try {
        return new Intl.DateTimeFormat(void 0, {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false, timeZone
        }).format(now);
    } catch {
        return "--:--:--";
    }
}

function DigitalClock() {
    const now = useNow(1000);
    const { extraTimezones } = settings.use(["extraTimezones"]);

    const zones = React.useMemo(
        () => extraTimezones
            .split(",")
            .map(z => z.trim())
            .filter(z => z.length > 0 && z.length <= 40 && isValidTimezone(z))
            .slice(0, 4),
        [extraTimezones]
    );

    return (
        <div className="vc-glance-subcard">
            <span className="vc-glance-subcard-title">Digital Clock</span>
            <div className="vc-glance-clock-rows">
                <div className="vc-glance-clock-row">
                    <span className="vc-glance-clock-zone">Local</span>
                    <span className="vc-glance-clock-time">{formatTime(now)}</span>
                </div>
                {zones.map(zone => (
                    <div className="vc-glance-clock-row" key={zone}>
                        <span className="vc-glance-clock-zone">{zone.split("/").pop()?.replaceAll("_", " ") ?? zone}</span>
                        <span className="vc-glance-clock-time">{formatTime(now, zone)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function formatDuration(totalMs: number) {
    const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

interface StopwatchState {
    running: boolean;
    /** Absolute ms the current run counts from (Date.now() - accumulated) */
    startedAt: number;
    /** Frozen elapsed ms while paused */
    elapsed: number;
}
const stopwatchStore = persistentState<StopwatchState>({ running: false, startedAt: 0, elapsed: 0 });

function Stopwatch() {
    const [sw, setSw] = stopwatchStore.use();

    // While running, re-render to advance the display; the value itself is
    // derived from absolute time, so it stays correct even after being hidden.
    React.useEffect(() => {
        if (!sw.running) return;
        const id = setInterval(() => setSw(s => ({ ...s })), 250);
        return () => clearInterval(id);
    }, [sw.running]);

    const elapsed = sw.running ? Date.now() - sw.startedAt : sw.elapsed;

    const toggle = () => {
        if (sw.running) setSw({ running: false, startedAt: sw.startedAt, elapsed: Date.now() - sw.startedAt });
        else setSw({ running: true, startedAt: Date.now() - sw.elapsed, elapsed: sw.elapsed });
    };

    const reset = () => setSw({ running: false, startedAt: 0, elapsed: 0 });

    return (
        <div className="vc-glance-subcard">
            <span className="vc-glance-subcard-title">Stopwatch</span>
            <div className="vc-glance-tool-display">{formatDuration(elapsed)}</div>
            <div className="vc-glance-tool-buttons">
                <button className="vc-glance-button vc-glance-button-brand" onClick={toggle}>
                    {sw.running ? "Pause" : "Start"}
                </button>
                <button className="vc-glance-button vc-glance-button-danger" onClick={reset}>
                    Reset
                </button>
            </div>
        </div>
    );
}

function clampInt(value: string, max: number) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max);
}

interface TimerState {
    minutes: string;
    seconds: string;
    /** Absolute ms the countdown ends at, or null when idle */
    endsAt: number | null;
}
const timerStore = persistentState<TimerState>({ minutes: "5", seconds: "0", endsAt: null });

function CountdownTimer() {
    const [timer, setTimer] = timerStore.use();
    const now = useNow(250);

    const remaining = timer.endsAt === null ? null : timer.endsAt - now;

    React.useEffect(() => {
        if (remaining !== null && remaining <= 0) {
            setTimer(t => ({ ...t, endsAt: null }));
            showToast("⏰ Quick Tools timer finished!", Toasts.Type.SUCCESS);
        }
    }, [remaining !== null && remaining <= 0]);

    const start = () => {
        const totalMs = (clampInt(timer.minutes, 999) * 60 + clampInt(timer.seconds, 59)) * 1000;
        if (totalMs > 0) setTimer(t => ({ ...t, endsAt: Date.now() + totalMs }));
    };

    return (
        <div className="vc-glance-subcard">
            <span className="vc-glance-subcard-title">Timer</span>
            {remaining === null
                ? (
                    <div className="vc-glance-timer-inputs">
                        <input
                            className="vc-glance-input vc-glance-timer-input"
                            type="text" inputMode="numeric" maxLength={3}
                            value={timer.minutes} placeholder="Min"
                            onChange={e => setTimer(t => ({ ...t, minutes: e.target.value.replace(/\D/g, "") }))}
                            aria-label="Minutes"
                        />
                        <span className="vc-glance-timer-sep">:</span>
                        <input
                            className="vc-glance-input vc-glance-timer-input"
                            type="text" inputMode="numeric" maxLength={2}
                            value={timer.seconds} placeholder="Sec"
                            onChange={e => setTimer(t => ({ ...t, seconds: e.target.value.replace(/\D/g, "") }))}
                            aria-label="Seconds"
                        />
                        <button className="vc-glance-button vc-glance-button-brand" onClick={start}>Set</button>
                    </div>
                )
                : (
                    <>
                        <div className="vc-glance-tool-display">{formatDuration(remaining)}</div>
                        <div className="vc-glance-tool-buttons">
                            <button className="vc-glance-button vc-glance-button-danger" onClick={() => setTimer(t => ({ ...t, endsAt: null }))}>
                                Cancel
                            </button>
                        </div>
                    </>
                )
            }
        </div>
    );
}

type CalcOp = "+" | "−" | "×" | "÷";

interface CalcState {
    display: string;
    accumulator: number | null;
    op: CalcOp | null;
    /** true while the user is typing the current operand */
    typing: boolean;
}

const CALC_INITIAL: CalcState = { display: "0", accumulator: null, op: null, typing: false };
const calcStore = persistentState<CalcState>(CALC_INITIAL);

function applyOp(a: number, b: number, op: CalcOp): number {
    switch (op) {
        case "+": return a + b;
        case "−": return a - b;
        case "×": return a * b;
        case "÷": return b === 0 ? NaN : a / b;
    }
}

function formatResult(n: number): string {
    if (!Number.isFinite(n)) return "Error";
    const str = String(Math.round(n * 1e10) / 1e10);
    return str.length > 12 ? n.toPrecision(8) : str;
}

/** Classic immediate-execution 4-function calculator. No eval, no parsing. */
function Calculator() {
    const [state, setState] = calcStore.use();

    const press = (key: string) => setState(prev => {
        if (key === "C") return CALC_INITIAL;

        if (key >= "0" && key <= "9") {
            const display = prev.typing && prev.display !== "0" ? prev.display + key : key;
            return display.length > 12 ? prev : { ...prev, display, typing: true };
        }

        if (key === ".") {
            if (prev.typing && prev.display.includes(".")) return prev;
            return { ...prev, display: prev.typing ? prev.display + "." : "0.", typing: true };
        }

        const current = parseFloat(prev.display);
        if (Number.isNaN(current)) return CALC_INITIAL;

        if (key === "=") {
            if (prev.op === null || prev.accumulator === null) return { ...prev, typing: false };
            return { display: formatResult(applyOp(prev.accumulator, current, prev.op)), accumulator: null, op: null, typing: false };
        }

        // Operator pressed: fold any pending operation first
        const accumulator = prev.op !== null && prev.accumulator !== null && prev.typing
            ? applyOp(prev.accumulator, current, prev.op)
            : current;
        return { display: formatResult(accumulator), accumulator, op: key as CalcOp, typing: false };
    });

    const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "C", "0", ".", "+"];

    return (
        <div className="vc-glance-subcard">
            <span className="vc-glance-subcard-title">Calculator</span>
            <div className="vc-glance-calc-display" aria-live="polite">{state.display}</div>
            <div className="vc-glance-calc-grid">
                {keys.map(key => (
                    <button
                        key={key}
                        className={"vc-glance-calc-key" + (/\d|\./.test(key) ? "" : " vc-glance-calc-key-op")}
                        onClick={() => press(key)}
                    >
                        {key}
                    </button>
                ))}
                <button className="vc-glance-calc-key vc-glance-calc-key-equals" onClick={() => press("=")}>=</button>
            </div>
        </div>
    );
}

/* Discord's <t:unix:FORMAT> dynamic timestamps - the thing people open
   HammerTime in a browser tab for. Pick a moment, pick a style, copy the code;
   it renders in every reader's own timezone. */

const TIMESTAMP_FORMATS: Array<{ label: string; value: string; }> = [
    { label: "Relative (in 3 hours)", value: "R" },
    { label: "Short time (16:20)", value: "t" },
    { label: "Long time (16:20:30)", value: "T" },
    { label: "Short date (20/04/2026)", value: "d" },
    { label: "Long date (20 April 2026)", value: "D" },
    { label: "Date & time", value: "f" },
    { label: "Weekday, date & time", value: "F" }
];

/** Approximates how Discord will render <t:unix:fmt>, for the live preview */
function previewTimestamp(ms: number, format: string): string {
    const m = moment(ms);
    switch (format) {
        case "t": return m.format("HH:mm");
        case "T": return m.format("HH:mm:ss");
        case "d": return m.format("L");
        case "D": return m.format("LL");
        case "f": return m.format("LL HH:mm");
        case "F": return m.format("dddd, LL HH:mm");
        default: return m.fromNow();
    }
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time */
function toLocalInputValue(ms: number): string {
    return moment(ms).format("YYYY-MM-DDTHH:mm");
}

// value starts empty and lazy-inits to "now" on first open, so a picked time
// survives collapse but an untouched builder still opens on the current moment.
const timestampStore = persistentState<{ value: string; format: string; }>({ value: "", format: "R" });

function TimestampBuilder() {
    const [ts, setTs] = timestampStore.use();

    React.useEffect(() => {
        if (!ts.value) setTs(t => ({ ...t, value: toLocalInputValue(Date.now()) }));
    }, []);

    const { format } = ts;
    const value = ts.value || toLocalInputValue(Date.now());
    const setValue = (v: string) => setTs(t => ({ ...t, value: v }));
    const setFormat = (f: string) => setTs(t => ({ ...t, format: f }));

    const parsed = Date.parse(value);
    const valid = Number.isFinite(parsed);
    const code = valid ? `<t:${Math.floor(parsed / 1000)}:${format}>` : "";

    const copy = () => {
        if (!valid) return;
        try {
            if (Clipboard?.SUPPORTS_COPY) Clipboard.copy(code);
            else void navigator.clipboard?.writeText(code);
            showToast("Timestamp copied - paste it into any chat.", Toasts.Type.SUCCESS);
        } catch {
            showToast("Couldn't copy to clipboard.", Toasts.Type.FAILURE);
        }
    };

    return (
        <div className="vc-glance-subcard">
            <span className="vc-glance-subcard-title">Timestamp</span>
            <input
                className="vc-glance-input vc-glance-timestamp-when"
                type="datetime-local"
                value={value}
                onChange={e => setValue(e.target.value)}
                aria-label="Timestamp date and time"
            />
            <Dropdown
                className="vc-glance-timestamp-format"
                options={TIMESTAMP_FORMATS}
                value={format}
                onChange={setFormat}
                ariaLabel="Timestamp style"
            />
            <div className="vc-glance-timestamp-out">
                <span className="vc-glance-timestamp-preview">
                    {valid ? previewTimestamp(parsed, format) : "Pick a date"}
                </span>
                <button
                    className="vc-glance-button vc-glance-button-brand"
                    disabled={!valid}
                    onClick={copy}
                >
                    Copy
                </button>
            </div>
        </div>
    );
}

export function QuickToolsWidget() {
    return (
        <WidgetCard id="quick-tools">
            <div className="vc-glance-tools-grid">
                <div className="vc-glance-tools-column">
                    <DigitalClock />
                    <CountdownTimer />
                    <TimestampBuilder />
                </div>
                <div className="vc-glance-tools-column">
                    <Stopwatch />
                    <Calculator />
                </div>
            </div>
        </WidgetCard>
    );
}
