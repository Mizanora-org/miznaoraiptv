# 📺 Mizanora IPTV — Full System v4

**Mizanora IPTV** — live TV, searchable IMDb catalogs, Xtream Codes, MAG/Stalker, reseller APIs and a functional owner admin panel. A **Mizanora Projects** product by **Muaaz Iqbal** (Kasur, Punjab, Pakistan).

## Run locally

```bash
npm install
npm run dev       # http://localhost:3000 (binds 0.0.0.0)
npm test          # API/protocol + real admin DOM interaction tests
```

Local development can use `/tmp/miznaoraiptv-rtdb-mirror.json` when Firebase is unreachable. This mirror is only a development fallback.

## Required Vercel/Firebase setup

The public Firebase web config is included. **A service account is required for durable server writes on Vercel** because serverless `/tmp` storage is temporary and is not shared between invocations.

1. Firebase Console → **Project settings → Service accounts → Generate new private key**.
2. Vercel → **Settings → Environment Variables** → add the complete JSON as sensitive variable **`FIREBASE_SERVICE_ACCOUNT_JSON`**. Alternatively use `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (see `.env.example`).
3. Set strong production values for **`MZ_OWNER_PIN`**, **`MZ_SESSION_SECRET`** and **`MZ_STREAM_SECRET`**. Never commit these secrets.
4. Firebase Authentication → enable Google, then add the Vercel domain under **Authorized domains**. The owner is `muaaziqbal.vip@gmail.com`.
5. Publish `firebase/database.rules.json`. The service account accesses RTDB with elevated privileges; do not expose its JSON in browser code.
6. Redeploy after changing environment variables.

On Vercel, a failed Firebase write returns an explicit error instead of pretending that a temporary file is a durable save. `/api/embed?action=health` and the admin dashboard expose storage health without exposing credentials.

## Working surfaces

| Surface | Route | Functionality |
|---|---|---|
| Public site | `/` | Channel grid with actual HLS playback (HLS.js + native HLS), free-trial and order forms |
| Owner admin | `/admin` | Google owner login or Owner PIN; 13 tabs with working channel/playlist CRUD, Xtream lifecycle, users, orders, resellers, settings, analytics and API keys |
| Xtream Codes | `/player_api.php`, `/get.php`, `/xmltv.php` | Login plus `get_live_categories`, `get_live_streams`, VOD/series lists and info, M3U and XMLTV |
| Stream URLs | `/live/…`, `/movie/…`, `/series/…`, `/s/<token>` | Credential checks, 15-minute HMAC tokens, valid HLS variant playlists and direct-file redirects |
| MAG / Stalker | `/portal.php`, `/stalker_portal/server/load.php`, `/c/portal.php` | Handshake, active-MAC profile, genres/channel lists and `create_link` |
| Reseller API | `/api/panel?action=help` | Register/login, credits, clients, MACs, renew/suspend/delete, pricing, payments and key rotation |
| Embed | `/embed.js`, `/embed.html`, `/api/embed` | CORS-enabled channel widget, searchable catalogs, free preview tokens, orders/trials |

### Catalog and content rights

The repository includes 18 default live channel records, 1,134 movie metadata records and 437 series metadata records. An IMDb title or poster is **not a video stream**. Movies/episodes without a licensed `streamUrl` are honestly marked **Metadata only**; configure playback URLs in the admin panel or RTDB. Only stream content you own or have permission to distribute.

## Owner admin notes

- New admin API keys are shown once. Revoke uses the key ID returned by the server; secret hashes are never sent back to the browser.
- A username or MAC cannot overwrite another client. Orders can only be reviewed once.
- Public account resolution requires the correct password; a username alone does not reveal playlist credentials.
- Default local development credentials remain compatible with existing installs. Set `MZ_OWNER_PIN` in production.
- All external stream availability and CORS policy depend on the upstream provider. The player reports these failures instead of substituting an unrelated channel.

## Tests

```bash
npm test
npm run test:dom
```

The suite checks real HTTP flows (public/admin/reseller, Xtream actions, signed playback, MAG, validation and CRUD) and jsdom click-throughs against the actual admin JavaScript. Test data uses an isolated local mirror; production Firebase is not required for the suite.
