<div align="center">

<img src="public/assets/img/brand/miznaoraiptv-logo.png" alt="Mizanora IPTV Logo" width="150px" />

# 🛡️ Mizanora IPTV — Private Admin Panel (`miznaoraiptv`)

**Sirf admin panel.** Public website hata di gayi hai — `/` seedha locked admin panel par jata hai. Poora IPTV service system (Live TV channels, Xtream users, MAG/Stalker MAC clients, Movies/Series, Playlists, Resellers, Orders, Analytics, API Keys) is admin panel mein manage hota hai.

[![Ecosystem](https://img.shields.io/badge/Ecosystem-Mizanora%20Projects-d4af37?style=for-the-badge)](https://mizanora.vercel.app)
[![Founder](https://img.shields.io/badge/Founder-Muaaz%20Iqbal-22c55e?style=for-the-badge)](https://github.com/muaaziqbalvip)
[![Firebase](https://img.shields.io/badge/Firebase-mizanoranet-ffca28?style=for-the-badge&logo=firebase)](https://console.firebase.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

</div>

---

## 🔒 Access — locked, sirf owner ke liye

- Panel open hote hi **full-screen lock screen** dikhta hai: Mizanora logo + **🔒 LOCKED • Owner access only** + **Sign in with Google** button.
- Google login ke baad **sirf `muaaziqbal.vip@gmail.com` (email verified)** allow hota hai. Koi aur account → `⛔ Access denied` + automatic sign-out.
- Fallback: **Owner PIN** (bootstrap `03062015326`, foran change karo) — `mzp_…` session 12h.
- Panel `noindex` hai (robots.txt `Disallow: /`, `X-Robots-Tag` header) — **public ke liye band**.

## 🧰 Admin panel mein kya kya hai (poora IPTV system)

| Tab | Kaam |
| --- | --- |
| 📊 Dashboard | KPIs — channels, playlists, Xtream users, revenue, live status |
| 📺 Channels | Add/edit/delete/reorder, priority groups, tier (free/PRO), stream test, M3U import/export |
| 📋 Playlists | Cloud M3U8 playlists |
| ⚡ Xtream Accounts | Create/renew/suspend/activate/delete users, expiry, max connections, **MAC field (Stalker bind)** |
| 🎬 Movies / 📺 Series | IMDb VOD catalog (1,570+ titles) |
| 👤 Users | Registered Firebase users |
| 📈 Live Analytics | Online visitors, play log |
| 🏪 Resellers | Dealer codes, `mzr_` keys, credits, +10 top-up |
| 🧾 Orders | JazzCash orders — approve → auto-provision |
| 🛰️ Stalker / MAG | Saare MAC-bound clients (Xtream + panel), expiry ke saath |
| 🔑 API Keys | `mzk_…` keys create/revoke — apna external panel chalao |
| ⚙️ Settings | Welcome/offline/coming-soon/PRO videos, ticker, PRO WhatsApp |

UI naye **admin-luxe.css** theme se beautiful hai: emerald+gold glass, animated lock screen, glowing sidebar, glass cards, smooth tables/modals/toasts, light/dark toggle, responsive.

## 🚀 Run

```bash
npm run dev     # http://0.0.0.0:3000  -> locked admin panel
npm test        # module graph + full admin-only test suite (HTTP smoke included)
```

## ☁️ Deploy (Vercel) + Firebase `mizanoranet`

1. Firebase Console (`mizanoranet`): Authentication → **Google + Email/Password** enable; **Authorized domains** mein apna domain add karo; RTDB rules publish karo: [`firebase/database.rules.json`](firebase/database.rules.json) (admin lock: `muaaziqbal.vip@gmail.com` + `email_verified`).
2. Web config already set: `public/assets/js/firebase-client.js` (project `mizanoranet`, RTDB `mizanoranet-default-rtdb`).
3. Vercel mein repo import karo — `vercel.json` mein `/` → `/admin.html`, saare Xtream/MAG/API rewrites ready.
4. `/admin` kholo → **Google se `muaaziqbal.vip@gmail.com` sign in karo** → Super Admin.

### Env vars

> 🔒 **Firebase config already repo mein hardcoded hai** (project `mizanoranet`, RTDB `https://mizanoranet-default-rtdb.firebaseio.com`, web API key included) — **Vercel mein add karne ki zaroorat nahi**. Neeche ke vars sirf optional secrets/overrides hain:

```bash
PUBLIC_BASE_URL=https://miznaoraiptv.vercel.app
FIREBASE_DATABASE_URL=https://mizanoranet-default-rtdb.firebaseio.com
FIREBASE_API_KEY=AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M
FIREBASE_DATABASE_SECRET=...     # RTDB server-side access (panel persist)
MIZANORA_SIGNING_SECRET=...      # HMAC signed links + PIN sessions (openssl rand -hex 32)
MIZANORA_ADMIN_PIN=...           # optional (bootstrap 03062015326)
MIZANORA_ADMIN_TOKEN=...         # optional CI token
MZ_OWNER_EMAIL=muaaziqbal.vip@gmail.com
MZ_LINK_TTL_SEC=900
```

## 🔌 APIs (backend panel se hi manage hota hai)

- **Admin API** `/api/panel` with `mzk_…` key (Bearer or `x-api-key`): `admin/xtream-*`, `admin/stalker/list`, `admin/resellers`, `admin/credits-topup`, `admin/orders`, `admin/order-review`, `admin/api-keys|api-key-create|api-key-revoke`, `admin/settings|settings-set`, `admin/channels`, `admin/clients`, `admin/analytics|audit`, `admin/pin-login|pin-set`, `admin/me`.
  - Convention: `GET → ?action=…`, `POST → {"action":"…", …}` in JSON body.
- **Reseller API**: `mzr_…` key → `reseller/clients`, `reseller/client-create` (with `mac` → Stalker client), `client-renew|suspend|block`, `secure-link`, `stats`, `finance`.
- **Public Embed API** `/api/embed?action=config|channels|movies|series|order|trial|health` (CORS `*`) + `/embed.js` widget — kisi bhi apni website mein plans/channels/order/trial embed karo.
- **Xtream Codes protocol**: `/player_api.php`, `/get.php` (M3U plus), `/xmltv.php` (EPG), `/live|movie|series/:u/:p/:f`.
- **MAG/Stalker portal**: `/portal.php` (+ `/stalker_portal/server/load.php`, `/c/…`) — MAC auth; demo MAC `00:1A:79:00:00:01`.
- **Signed links**: `/s/<token>` (HMAC-SHA256, 15 min TTL).

## 🗂️ Structure

```
public/admin.html          # the ONLY page — locked private admin panel (+ admin-luxe.css theme)
public/assets/             # admin js/css, Mizanora logo+icons, firebase-sdk vendor
public/media/              # welcome / offline / coming-soon / pro-unlock broadcast videos
api/                       # serverless: xtream (player_api/get/xmltv/MAG portal), media, admin (panel/embed/analytics/sync/imdb), seo
data/                      # catalog (channels/brands/blogs), panel (plans/pricing), IMDb seed + streams
firebase/database.rules.json
scripts/dev-server.mjs     # 0.0.0.0:3000 dev server (rewrites from vercel.json)
vercel.json                # "/" -> /admin.html + all IPTV protocol rewrites
```

## 👤 Credits

**Muaaz Iqbal** — Founder & Lead Developer, Kasur, Punjab, Pakistan • [Mizanora Projects](https://mizanora.vercel.app) • [github.com/Mizanora-org](https://github.com/Mizanora-org) • Support: 0306-2015326 ([WhatsApp](https://wa.me/923062015326))
