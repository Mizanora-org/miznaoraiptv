# Changelog

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
