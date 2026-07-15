/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, SpotifyStore, Tooltip, useStateFromStores } from "@webpack/common";

import { getConfig, setNotes, setWeatherLocation, useGlanceConfig, WeatherLocation } from "../../data";
import { settings } from "../../settings";
import {
    celsiusToFahrenheit,
    emojiFromCode,
    fetchForecast,
    fetchWeather,
    ForecastDay,
    searchLocations,
    WeatherNow
} from "../../weather";
import { MusicIcon } from "../icons";
import { WidgetCard } from "../WidgetCard";

const SPOTIFY_TRACK_ID_RE = /^[a-zA-Z0-9]{22}$/;

function WeatherCard() {
    const { weatherLocation } = useGlanceConfig();
    const { temperatureUnit } = settings.use(["temperatureUnit"]);

    const [query, setQuery] = React.useState("");
    const [results, setResults] = React.useState<WeatherLocation[]>([]);
    const [searching, setSearching] = React.useState(false);
    const [weather, setWeather] = React.useState<WeatherNow | null>(null);
    const [forecast, setForecast] = React.useState<ForecastDay[] | null>(null);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
        setWeather(null);
        setForecast(null);
        setFailed(false);
        if (!weatherLocation) return;

        let cancelled = false;
        fetchWeather(weatherLocation).then(result => {
            if (cancelled) return;
            setWeather(result);
            setFailed(result === null);
        });
        fetchForecast(weatherLocation).then(days => {
            if (!cancelled) setForecast(days);
        });
        return () => { cancelled = true; };
    }, [weatherLocation?.lat, weatherLocation?.lon]);

    const runSearch = async () => {
        if (searching || query.trim().length < 2) return;
        setSearching(true);
        const found = await searchLocations(query);
        setResults(found);
        setSearching(false);
    };

    if (!weatherLocation) {
        return (
            <div className="vc-glance-subcard">
                <span className="vc-glance-subcard-title">Weather</span>
                <div className="vc-glance-weather-search">
                    <input
                        className="vc-glance-input"
                        type="text"
                        maxLength={64}
                        placeholder="Search a city…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") runSearch(); }}
                    />
                    <button className="vc-glance-button vc-glance-button-brand" disabled={searching} onClick={runSearch}>
                        {searching ? "…" : "Search"}
                    </button>
                </div>
                {results.length > 0 && (
                    <div className="vc-glance-weather-results">
                        {results.map(loc => (
                            <button
                                key={`${loc.lat},${loc.lon}`}
                                className="vc-glance-weather-result"
                                onClick={() => {
                                    setWeatherLocation(loc);
                                    setResults([]);
                                    setQuery("");
                                }}
                            >
                                {loc.name}
                            </button>
                        ))}
                    </div>
                )}
                <span className="vc-glance-hint">
                    Weather data comes from Open-Meteo, fetched only after you pick a location.
                </span>
            </div>
        );
    }

    const temp = weather === null ? null
        : temperatureUnit === "f"
            ? `${Math.round(celsiusToFahrenheit(weather.temperatureC))}°F`
            : `${Math.round(weather.temperatureC)}°C`;

    return (
        <div className="vc-glance-subcard">
            <div className="vc-glance-subcard-header">
                <span className="vc-glance-subcard-title">Weather</span>
                <button className="vc-glance-link-button" onClick={() => setWeatherLocation(null)}>
                    Change location
                </button>
            </div>
            {weather === null
                ? <span className="vc-glance-hint">{failed ? "Couldn't load weather right now." : "Loading…"}</span>
                : (
                    <>
                        <div className="vc-glance-weather-now">
                            <span className="vc-glance-weather-emoji" aria-hidden>{weather.isDay ? "☀️" : "🌙"}</span>
                            <div className="vc-glance-row-text">
                                <span className="vc-glance-row-title">{weatherLocation.name}: {temp}</span>
                                <span className="vc-glance-row-subtitle">
                                    {weather.condition} • wind {Math.round(weather.windKmh)} km/h
                                </span>
                            </div>
                        </div>
                        {forecast && forecast.length > 1 && (
                            <div className="vc-glance-forecast">
                                {forecast.slice(1).map(day => {
                                    const label = new Date(day.date).toLocaleDateString(void 0, { weekday: "short" });
                                    const hi = temperatureUnit === "f" ? Math.round(celsiusToFahrenheit(day.maxC)) : Math.round(day.maxC);
                                    const lo = temperatureUnit === "f" ? Math.round(celsiusToFahrenheit(day.minC)) : Math.round(day.minC);
                                    return (
                                        <div key={day.date} className="vc-glance-forecast-day">
                                            <span className="vc-glance-forecast-label">{label}</span>
                                            <span className="vc-glance-forecast-emoji" aria-hidden>{emojiFromCode(day.code)}</span>
                                            <span className="vc-glance-forecast-temp">
                                                <span className="vc-glance-forecast-hi">{hi}°</span>
                                                <span className="vc-glance-forecast-lo">{lo}°</span>
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )
            }
        </div>
    );
}

function SpotifyCard() {
    const track = useStateFromStores([SpotifyStore], () => SpotifyStore.getTrack());
    const activity = useStateFromStores([SpotifyStore], () => SpotifyStore.getActivity());

    // Ticks once a second purely to advance the progress bar while playing
    const [, tick] = React.useReducer(x => x + 1, 0);
    React.useEffect(() => {
        if (!activity?.timestamps?.end) return;
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [activity?.timestamps?.start, activity?.timestamps?.end]);

    if (!track) {
        return (
            <div className="vc-glance-subcard vc-glance-spotify">
                <div className="vc-glance-spotify-idle">
                    <MusicIcon size={18} />
                    <span className="vc-glance-hint">Nothing playing on Spotify</span>
                </div>
            </div>
        );
    }

    const artists = track.artists.map(a => a.name).join(", ");
    const albumArt = track.album.image?.url;
    // Only load album art from Spotify's own CDN - never an arbitrary host
    const showArt = typeof albumArt === "string" && /^https:\/\/(i\.scdn\.co|[\w.-]+\.spotifycdn\.com)\//.test(albumArt);

    const start = activity?.timestamps?.start;
    const end = activity?.timestamps?.end;
    const progress = start && end && end > start
        ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
        : null;

    const openTrack = () => {
        if (SPOTIFY_TRACK_ID_RE.test(track.id)) {
            window.open(`https://open.spotify.com/track/${track.id}`, "_blank", "noopener,noreferrer");
        }
    };

    return (
        <div className="vc-glance-subcard vc-glance-spotify">
            <div className="vc-glance-spotify-now">
                {showArt
                    ? <img className="vc-glance-spotify-art" src={albumArt} alt="" draggable={false} />
                    : <div className="vc-glance-spotify-art vc-glance-spotify-art-fallback"><MusicIcon size={20} /></div>
                }
                <div className="vc-glance-row-text">
                    <span className="vc-glance-row-title">{track.name}</span>
                    <span className="vc-glance-row-subtitle">{artists || "Spotify"}</span>
                </div>
                <button
                    className="vc-glance-icon-button"
                    aria-label="Open in Spotify"
                    title="Open in Spotify"
                    onClick={openTrack}
                >
                    <MusicIcon size={16} />
                </button>
            </div>
            {progress !== null && start && end && (
                <>
                    <div className="vc-glance-spotify-progress">
                        <div className="vc-glance-spotify-progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
                    </div>
                    <div className="vc-glance-spotify-times">
                        <span>{formatTrackTime(Math.min(Date.now() - start, end - start))}</span>
                        <span>{formatTrackTime(end - start)}</span>
                    </div>
                </>
            )}
        </div>
    );
}

function formatTrackTime(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/* Quick Notes understands a little plain-text structure - enough for lists and
   todos without becoming a markdown editor:
     - [ ] task   -> checkbox, clickable in view mode
     - item       -> bullet
     ---          -> divider
   Everything is stored as the raw text, so notes stay portable and greppable. */

const CHECKBOX_LINE = /^(\s*)- \[([ xX])\] ?(.*)$/;
const BULLET_LINE = /^(\s*)- (.*)$/;

function NoteLine({ line, index, onToggle }: { line: string; index: number; onToggle: (index: number) => void; }) {
    const checkbox = CHECKBOX_LINE.exec(line);
    if (checkbox) {
        const done = checkbox[2] !== " ";
        return (
            <label className={"vc-glance-note-check" + (done ? " vc-glance-note-done" : "")}>
                <input type="checkbox" checked={done} onChange={() => onToggle(index)} />
                <span>{checkbox[3]}</span>
            </label>
        );
    }
    if (/^\s*---+\s*$/.test(line)) return <hr className="vc-glance-note-divider" />;
    const bullet = BULLET_LINE.exec(line);
    if (bullet) return <div className="vc-glance-note-bullet">{bullet[2]}</div>;
    if (line.trim() === "") return <div className="vc-glance-note-gap" />;
    return <div className="vc-glance-note-text">{line}</div>;
}

function NotesCard() {
    // setNotes deliberately doesn't emit (typing shouldn't rerender the world),
    // so this card manages its own refresh and reads the config directly.
    const [, refresh] = React.useReducer(x => x + 1, 0);
    const [editing, setEditing] = React.useState(() => getConfig().notes.trim().length === 0);
    const inputRef = React.useRef<HTMLTextAreaElement>(null);
    const { notes } = getConfig();

    /** Prefixes the line under the cursor (or inserts a block) in the editor */
    const insertAtLine = (prefix: string, block = false) => {
        const el = inputRef.current;
        if (!el) return;
        const pos = el.selectionStart ?? el.value.length;
        if (block) {
            const insertion = (pos > 0 && el.value[pos - 1] !== "\n" ? "\n" : "") + prefix + "\n";
            el.value = el.value.slice(0, pos) + insertion + el.value.slice(pos);
            el.setSelectionRange(pos + insertion.length, pos + insertion.length);
        } else {
            const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1;
            el.value = el.value.slice(0, lineStart) + prefix + el.value.slice(lineStart);
            el.setSelectionRange(pos + prefix.length, pos + prefix.length);
        }
        el.focus();
        setNotes(el.value);
    };

    const toggleCheckbox = (lineIndex: number) => {
        const lines = getConfig().notes.split("\n");
        const match = CHECKBOX_LINE.exec(lines[lineIndex] ?? "");
        if (!match) return;
        const flipped = match[2] === " " ? "x" : " ";
        lines[lineIndex] = `${match[1]}- [${flipped}] ${match[3]}`;
        setNotes(lines.join("\n"));
        refresh();
    };

    return (
        <div className="vc-glance-subcard">
            <div className="vc-glance-notes-head">
                <span className="vc-glance-subcard-title">Quick Notes</span>
                <div className="vc-glance-notes-tools">
                    {editing && (
                        <>
                            <Tooltip text="Bullet">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("- ")}>•</button>
                                )}
                            </Tooltip>
                            <Tooltip text="Checkbox">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("- [ ] ")}>☑</button>
                                )}
                            </Tooltip>
                            <Tooltip text="Divider">
                                {props => (
                                    <button {...props} className="vc-glance-note-tool" onClick={() => insertAtLine("---", true)}>-</button>
                                )}
                            </Tooltip>
                        </>
                    )}
                    <Tooltip text={editing ? "Done" : "Edit"}>
                        {props => (
                            <button
                                {...props}
                                className="vc-glance-note-tool vc-glance-note-mode"
                                onClick={() => { setEditing(e => !e); refresh(); }}
                            >
                                {editing ? "✓" : "✎"}
                            </button>
                        )}
                    </Tooltip>
                </div>
            </div>

            {editing
                ? (
                    <textarea
                        ref={inputRef}
                        className="vc-glance-notes"
                        defaultValue={notes}
                        maxLength={20000}
                        placeholder={"Quick notes…\n- bullets\n- [ ] todos\n--- dividers"}
                        spellCheck={false}
                        onChange={e => setNotes(e.target.value)}
                    />
                )
                : (
                    <div
                        className="vc-glance-notes-view"
                        role="button"
                        tabIndex={0}
                        onDoubleClick={() => setEditing(true)}
                    >
                        {notes.trim().length === 0
                            ? <span className="vc-glance-hint">Nothing noted - hit ✎ to write.</span>
                            : notes.split("\n").map((line, i) => (
                                <NoteLine key={i} line={line} index={i} onToggle={toggleCheckbox} />
                            ))
                        }
                    </div>
                )
            }
        </div>
    );
}

export function IntegrationsWidget() {
    return (
        <WidgetCard id="integrations">
            <div className="vc-glance-stack">
                <WeatherCard />
                <SpotifyCard />
                <NotesCard />
            </div>
        </WidgetCard>
    );
}
