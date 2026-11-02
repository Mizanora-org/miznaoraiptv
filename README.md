# 📺 Mizanora IPTV — Full System (Fresh Rebuild v3)

**Mizanora IPTV** — Live TV • IMDb Movies & Series • Xtream Codes • MAG/Stalker Portal • Reseller API • Owner-locked Admin Panel.
A **Mizanora Projects** product by **Muaaz Iqbal** (Kasur, Punjab, Pakistan).

## 🚀 Run

```bash
npm install        # only for the DOM smoke test (jsdom+esbuild devDeps)
npm run dev        # → http://0.0.0.0:3000
npm test           # 88 API checks + 24 headless admin-panel click-through checks
```

Deploy: import this repo on **Vercel** (no env vars needed — Firebase is hardcoded, see below).

## 🔒 Firebase — hardcoded in the repo (project `mizanoranet`)

`public/assets/js/firebase-client.js` + `api/_lib/rtdb.js` contain the full config already:

- projectId `mizanoranet` · authDomain `mizanoranet.firebaseapp.com`
- **RTDB `https://mizanoranet-default-rtdb.firebaseio.com`**
- apiKey / appId / measurementId baked in — **Vercel mein kuch add karne ki zaroorat nahi** (`.env.example` vars sirf optional overrides hain)

Firebase Console (`mizanoranet`): enable **Google + Email/Password** auth, add your domain to **Authorized domains**, and publish `firebase/database.rules.json` (panel sirf `muaaziqbal.vip@gmail.com` + `email_verified` ko read/write deta hai).

## 🧱 What's inside

| Surface | Route | Notes |
|---|---|---|
| Public site | `/` | landing + live channel preview (embed API) + trial & order forms |
| Admin panel | `/admin` | **full-screen lock** → Google owner login (only `muaaziqbal.vip@gmail.com`) or Owner PIN `03062015326`; 13 tabs: dashboard, channels, playlists, xtream, movies, series, analytics, users, settings, resellers, orders, stalker/MAG, API keys |
| Embed widget | `/embed.js` + `/embed.html` | drop-in channel grid, CORS `*` |
| Panel API | `/api/panel?action=…` | public / reseller (`mzr_`) / admin (Firebase token, `mzp_` PIN session, `mzk_` key) — see `?action=help` |
| Xtream Codes | `/player_api.php`, `/get.php`, `/xmltv.php`, `/live|/movie|/series/:u/:p/:file` | M3U+EPG, 302 → signed `/s/<token>` (HMAC-SHA256, 15 min) |
| MAG / Stalker | `/portal.php`, `/stalker_portal/server/load.php`, `/c/…` | handshake token TTL 8h |
| Embed API | `/api/embed?action=config\|channels\|movies\|series\|order\|trial\|order-status\|health` | CORS `*` |

## 🏪 Reseller business

Self-serve register (`reseller/register`) → free starter credits → `mzr_…` API key → create clients (incl. **MAC/Stalker**), set own PKR pricing, record payments, renew/suspend/block/delete, rotate key. Dealer rate Rs 100/user/month; direct Rs 200. Support WhatsApp **0306-2015326**.

## ✅ Tests

`npm test` runs `scripts/self-test.mjs` (structure + live HTTP over every protocol incl. full admin & reseller lifecycles — **88 checks**) and `scripts/smoke-admin-dom.mjs` (jsdom headless click-through of the real admin panel: lock → PIN → 13 tabs → buttons — **24 checks, zero uncaught errors**).
