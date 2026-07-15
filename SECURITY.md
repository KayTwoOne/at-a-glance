# Security review - At a glance

Audited at v0.8.0. Scope: the whole plugin (`src/userplugins/atAGlance/`).

## Summary

No vulnerabilities found. The plugin cannot leak your Discord token, makes no
unnecessary network requests, and has no code-injection surface. Every mutating
action goes through Discord's own authenticated APIs - the plugin never sees,
stores, or transmits credentials.

## Token / credential exposure - none

- **No token access.** Grep of the entire plugin for `token`, `localStorage`,
  `document.cookie`, `authorization`, `getToken`, `.headers` finds only false
  positives (design "tokens", keyboard "token"). The plugin never reads the
  Discord token or any auth material.
- **All mutations via Discord's own APIs.** Notes, friend nicknames, block/
  ignore, event RSVPs, calls, message sends, acks, and voice joins all go
  through Discord's own `RestAPI` / action creators, which attach auth
  internally in the host. The plugin only ever passes snowflake IDs and text.

## Network surface - one integration, opt-in, allowlisted

- **The only outbound host family is Open-Meteo** (weather), and only after you
  explicitly pick a location. Requests are pinned to two hard-coded HTTPS
  endpoints (enforced by a wrapper that throws on any other URL), sent with
  `credentials: "omit"` and `referrerPolicy: "no-referrer"`, time-limited, and
  responses are schema-validated. CSP allowlist (`native.ts`) is limited to the
  two Open-Meteo hosts.
- **No other fetch/XHR/WebSocket/beacon** anywhere in the plugin.

## Media/URL sinks - all allowlisted to trusted hosts

- Message attachment images render only when `content_type` is `image/*` **and**
  the URL is on `cdn.discordapp.com` / `media.discordapp.net`.
- Nameplate art: the asset path is validated (`^[\w/-]+\/$`) and interpolated
  into a fixed `cdn.discordapp.com/assets/collectibles/` prefix - cannot break
  out to another host or inject query params.
- Spotify album art: restricted to Spotify's CDN (`i.scdn.co` / `*.spotifycdn.com`).
- Avatars and guild icons come from Discord's own URL builders.
- The single `window.open` (Spotify track) validates the 22-char track ID and
  uses `noopener,noreferrer`.

## Injection - none

- No `eval`, `new Function`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`,
  `document.write`, or `dangerouslySetInnerHTML`.
- All user/remote text renders through React text nodes (auto-escaped) or
  Discord's own message parser/component.
- No dynamic `RegExp` built from user input (no ReDoS).

## Stored data - minimal, validated, isolated

- Persisted config (IndexedDB via Vencord `DataStore`) holds only: snowflake IDs
  (regex-validated), plain-text notes/reminders/snippets (length-capped),
  a weather location (name + clamped lat/lon), appearance values (hex + clamped
  numbers), and layout state (widget order/collapse/hidden, rail & popup widths).
- **No token, message-history, or PII is ever persisted.** Bookmarks store a
  plain-text snapshot + IDs; names/avatars are always resolved live.
- Loaded config is treated as untrusted and rebuilt field-by-field through an
  allowlist sanitizer (unknown keys dropped, lists deduped and hard-capped).
  No untrusted object is ever spread or merged → no prototype-pollution vector.
- Config is keyed per-account and mutations never persist until that account's
  config has loaded.

## Failure containment

- The sidebar tab, every widget, the popup message/composer, and the rail strip
  are wrapped in `ErrorBoundary`s. The native message renderer and native chat
  input each fall back to a plain implementation if Discord internals change, so
  a Discord update degrades to reduced features rather than a broken client.
