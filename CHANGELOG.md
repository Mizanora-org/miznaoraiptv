## 6.1.2 — Reconnect intro-loop fix

- Resume recent authenticated Xtream/M3U entries instead of creating a new intro on every reconnect.
- Retire played intro segments once the live window has sufficient duration; remove the start-at-zero hint after the intro window.
- Preserve media/discontinuity sequences across reconnects and invalidate old generation tokens after a genuine idle retune.
- Website Retry reconnects without replaying its already-shown intro.
- Add reconnect, concurrent retry, player identity and generation-isolation regression coverage.

## 6.1.1 — Playback reliability

- Fix false-offline handling for fractional EXTINF values, declared target durations, provider probe restrictions and incompatible stitching formats.
- Publish intro/live buffers upfront; preserve delayed-refresh segments; pin/coalesce source discovery with bounded caching and retry grace.
- Add automatic original-source compatibility and per-channel Direct mode.
- Extend new playback capabilities to seven days with rolling idle cleanup and password-change revocation; keep short owner previews.
- Add bounded browser recovery, guide-availability notices across XMLTV/short EPG/public guide, and simulated 72-hour stability tests.

## 6.1.0 — 2026-11-03

- Vercel-native HLS manifest playout enabled by default for compatible live sources: eight-second intro, live media, offline recovery, recharge and coming-soon loops.
- Durable Firebase ETag/CAS session timelines, bounded media windows, expiry cleanup, explicit AES-128 IV preservation and authenticated playlist refreshes.
- MPEG-TS `.ts` aliases for external-player compatibility; bounded master resolution and segment probes.
- Owner Broadcast Studio with signed playback previews and manifest inspection; responsive graphite/emerald/gold dashboard redesign.
- Serverless HLS integration/reducer tests and real FFmpeg stitched-media decoding.

## 6.0.0 — 2026-11-03

- Added opt-in VPS HLS gateway: dynamic branded intro, live transcoding, offline failover, subscription rechecks, bounded sessions, Docker deployment and real-FFmpeg integration tests.
- Added Academy DOM regression tests.

- Secure reseller login usernames, scrypt credentials, revocable sessions and client username/password changes.
- Stable channel numbering, persisted sorting, EPG mapping and bounded source probes.
- Searchable movie/series management and public catalog with honest availability labels.
- `/c/` MAG setup and authenticated Stalker protocol actions.
- Embedded owner/reseller Academy with checklists and quizzes.
- Replaced all four bundled broadcast cards with animated eight-second MP4/HLS files and posters; dynamic website channel/payment overlays.
- Added regression coverage for session invalidation, client renames and MAC-bound portal pagination.

# Changelog

## 5.1.2 — 2026-11-02

- Add a direct channel number / playlist-position field to channel create and edit; ordering stays synchronized across the public list, M3U, Xtream and MAG outputs while stream IDs remain stable.
- Add sortable movie and series views by title, release year, rating and playable status.
- Keep the new admin controls responsive and keyboard-accessible.

## 5.1.0 — 2026-11-02

- Add reseller business reports, activity history and upcoming-expiry dashboard.
- Give owner reseller report, suspension and reactivation controls.
- Scope reports per reseller, exclude passwords from client lists and validate top-ups.
- Add integration guidance for a separate website backend and animated README banner.
- Prevent client-supplied start dates from overriding reseller plan dates.


## 5.0.0 — 2026-11-02

### Added

- Configurable welcome intro before secure channel fetch, with skip, timeout, retry and cancellation handling.
- Animated channel catalog, premium/recharge states and reduced-motion support.
- Mizanora Welcome & Promo Live channel using bundled media.
- Search, category filters and progressive channel rendering.
- M3U file/URL imports with metadata parsing, duplicate-safe merging and playlist history.
- XMLTV file/URL imports, multiple EPG sources, refresh/delete and now/next web guide.
- Xtream short EPG responses and programme-rich authenticated XMLTV output.
- Public recharge contact lookup and dedicated reseller dashboard.
- Reseller registration/login, clients, credits, pricing, payments, ledger and key rotation UI.
- Dynamic developer guide, configurable website embed and clean `/reseller`, `/developers`, `/guide` routes.
- Vercel, M3U/EPG and reseller documentation.

### Fixed

- Corrected bundled HLS playlists to reference existing `.m2ts` segments instead of missing `.ts` files.
- Settings validation for intro URLs, durations, toggles and contact text.
- Guide lookup uses indexed programme mapping for imported catalogs.
- XMLTV output maps exact channel-name fallbacks, preserves programme dates and avoids orphan channel declarations.
- M3U `x-tvg-url` keeps `&password=` intact for player EPG authentication.
- Imported categories receive valid numeric Xtream category mappings.
- Escape/cancel closes the player with the same cleanup as the close button; intro progress follows configured duration.
- Remote imports enforce size/time limits and production private-network protections, including mapped-IP forms.

### Notes

- IMDb metadata-only titles still require licensed stream URLs.
- Browser playback depends on upstream HTTPS/CORS support.
- Durable Vercel writes still require Firebase service-account configuration.
