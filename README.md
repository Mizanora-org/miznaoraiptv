<div align="center">

<img src="public/assets/img/brand/miznaoraiptv-logo.png" alt="Mizanora IPTV Logo" width="160px" />

# 📺 Mizanora IPTV (`miznaoraiptv`)

**Mizanora Projects ka flagship IPTV platform — Live TV, Movies & Series (IMDb), Xtream Codes, MAG/Stalker Portal, Reseller Panel aur Embeddable API. Ek hi professional admin panel.**

[![Live Website](https://img.shields.io/badge/Live-miznaoraiptv.vercel.app-10b981?style=for-the-badge&logo=vercel)](https://miznaoraiptv.vercel.app)
[![Parent Ecosystem](https://img.shields.io/badge/Ecosystem-Mizanora%20Projects-d4af37?style=for-the-badge)](https://mizanora.vercel.app)
[![Founder](https://img.shields.io/badge/Founder%20%26%20Developer-Muaaz%20Iqbal-22c55e?style=for-the-badge)](https://github.com/muaaziqbalvip)
[![Firebase](https://img.shields.io/badge/Firebase-mizanoranet-ffca28?style=for-the-badge&logo=firebase)](https://console.firebase.google.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

</div>

---

## 🌟 Kya hai ye? (English + Roman Urdu)

**Mizanora IPTV** ek full-stack IPTV ecosystem hai jo Firebase (**project `mizanoranet`**) par chalta hai:

| Module | Kya karta hai |
| --- | --- |
| **📺 Live TV (HLS Studio Player)** | Browser mein `hls.js` player — quality selector, multi-audio, PiP, theater mode, welcome intro video, channel-offline standby video. |
| **🎬 IMDb Movies & Series (VOD)** | IMDb ID (`tt…`) se 1-click/bulk load — rating, poster, cast, plot. Library build hoti hai to har item **"Coming Soon"** video chalata hai. 1,570+ titles ka catalog included. |
| **🔐 Firebase Auth (Google + Email)** | Google Sign-In aur Gmail/Email+Password dono. Har user ko **1 FREE personal Xtream Codes server**. |
| **🛰️ Xtream Codes API** | `/player_api.php`, `/get.php` (M3U Plus), `/xmltv.php` (EPG) — IPTV Smarters, TiviMate, XCIPTV, VLC sab mein chalta hai. |
| **📱 MAG / Stalker Portal** | `/portal.php`, `/stalker_portal/server/load.php` — MAC-based boxes (Infomir MAG, Enigma2) direct connect. |
| **🏪 Reseller Panel + API** | `/reseller` — self-serve signup, credits (PKR 100/user), clients (Xtream + MAC), renew/suspend, revenue. API key `mzr_…` se kisi bhi apni website/backend se panel control. |
| **🔌 Embed API (koi bhi website mein)** | `/api/embed` (CORS `*`) + `/embed.js` widget — plans, live channels, order form, free trial — kisi bhi site mein 2 lines mein embed. Docs: [`/embed.html`](public/embed.html). |
| **🛡️ Admin Panel (locked)** | `/admin` — **sirf `muaaziqbal.vip@gmail.com` Google login (email_verified) se Super Admin**. Channels, users, Xtream accounts, resellers, orders, credits, analytics, audit log, settings, PIN fallback — sab kuch. |
| **⚡ Fast & smooth** | Local cache + background refresh, 2.5–3.5s read ceilings, idle-time catalog import, HLS prefetch — page kabhi hang nahi hota. |
| **🎨 Mizanora Brand** | Official gold-M icon (PWA icons 192/512/maskable, apple-touch, favicon, OG image), emerald + gold themes, 6 light/dark broadcast themes. |

---

## 🚀 Run karo (local)

```bash
npm run dev        # http://0.0.0.0:3000  (scripts/dev-server.mjs)
npm test           # module checks + 25+ self-tests + DOM smoke test
```

## ☁️ Deploy (Vercel) + Firebase setup

1. **Firebase Console (`mizanoranet`)** — Authentication → Google **aur** Email/Password enable karo; Authorized domains mein apna domain add karo (`miznaoraiptv.vercel.app` + previews). Realtime Database rules: [`firebase/database.rules.json`](firebase/database.rules.json) publish karo.
2. **Web config** already set hai `public/assets/js/firebase-client.js` mein (project `mizanoranet`):

```js
const firebaseConfig = {
  apiKey: "AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M",
  authDomain: "mizanoranet.firebaseapp.com",
  databaseURL: "https://mizanoranet-default-rtdb.firebaseio.com",
  projectId: "mizanoranet",
  storageBucket: "mizanoranet.firebasestorage.app",
  messagingSenderId: "1047231858393",
  appId: "1:1047231858393:web:7e9fa18b59172f806da0c8",
  measurementId: "G-8R6RGY3RLV"
};
```

3. Vercel mein ye repo import karo — `public/` static + `api/` serverless (zero build step).
4. `/admin` kholo aur **`muaaziqbal.vip@gmail.com` se Google login karo** — tum automatically Super Admin ban jaoge.

### 🔑 Env vars (Vercel → Settings → Environment Variables)

```bash
PUBLIC_BASE_URL=https://miznaoraiptv.vercel.app
FIREBASE_DATABASE_URL=https://mizanoranet-default-rtdb.firebaseio.com
FIREBASE_API_KEY=AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M
FIREBASE_DATABASE_SECRET=...        # RTDB server-side read/write ke liye (panel persist karne ke liye zaroori)
MIZANORA_SIGNING_SECRET=...         # HMAC signed links + PIN sessions (openssl rand -hex 32)
MIZANORA_ADMIN_PIN=...              # optional; bootstrap PIN 03062015326
MIZANORA_ADMIN_TOKEN=...            # optional script/CI token
MZ_OWNER_EMAIL=muaaziqbal.vip@gmail.com   # admin lock (default already set)
MZ_LINK_TTL_SEC=900                 # signed playback link TTL
```

Without `FIREBASE_DATABASE_SECRET` panel local in-process mirror par bhi chalega (dev/test ke liye fine).

---

## 🛰️ IPTV protocols (apps/STB setup)

| Field | Value |
| --- | --- |
| Server URL | `https://miznaoraiptv.vercel.app` (port 443) |
| M3U Plus | `/get.php?username=USER&password=PASS&type=m3u_plus&output=m3u8` |
| EPG XMLTV | `/xmltv.php?username=USER&password=PASS` |
| Player API | `/player_api.php?username=USER&password=PASS` |
| MAG/Stalker | Portal `/portal.php` + MAC register (panel client `mac` field) |

Free Xtream credentials claim karo: site par login karo → **Xtream Vault**.

---

## 🔌 Embed API — kisi bhi website mein lagao

```html
<div id="mizanora-widget"></div>
<script src="https://miznaoraiptv.vercel.app/embed.js"
        data-mz-target="#mizanora-widget"
        data-mz-widget="plans"        <!-- plans | channels | order | trial -->
        data-mz-api="https://miznaoraiptv.vercel.app"
        data-mz-theme="dark" defer></script>
```

REST (CORS open):

```
GET  /api/embed?action=config|channels|movies|series|order-status|health
POST /api/embed?action=order   {name, whatsapp, planId, audience, txnId}
POST /api/embed?action=trial   {email, whatsapp}
POST /api/embed?action=reseller/register {name, email, password, whatsapp}
```

Poori docs + live demo: **`/embed.html`**.

---

## 🏪 Reseller business (self-serve)

- Reseller khud `/reseller` se signup karta hai → `mzr_…` API key + 3 starter credits.
- Client create = 1 credit = 30 din (Xtream user/pass auto + M3U/EPG links + optional MAC).
- Dealer rate **PKR 100/user/month**, direct client **PKR 200/month**, trial **1 din FREE**.
- Payment: JazzCash `0306-2015326` (Muaaz Iqbal) → screenshot WhatsApp → admin approve → auto-provision.
- Expiry par auto-block; client ko apne reseller ka recharge number dikhta hai.
- Detail: [`RESELLER-BUSINESS.md`](RESELLER-BUSINESS.md), [`PANEL-GUIDE.md`](PANEL-GUIDE.md)

### Panel API actions (`/api/panel`)

`config • plans • order • order-status • trial • resolve • reseller/login|register|clients|client-create|client-renew|client-suspend|secure-link|stats|finance|ledger • admin/* (analytics, orders, order-review, resellers, reseller-create, credits-topup, clients, audit, pin-login, pin-set)`

---

## 🗂️ Project structure

```
public/            # web app (index), admin.html, reseller.html, embed.html, assets, media (welcome/offline/coming-soon/pro-unlock videos)
api/               # serverless: xtream.js (player_api/get/xmltv/MAG portal), media.js, admin.js (panel/analytics/sync/imdb), embed.js (public embed API)
data/              # catalog.js (BRAND + channels + blogs), panel.js (plans/pricing/legal), imdb-seed + imdb-catalog-2000, streams/*.m3u8
firebase/          # database.rules.json — admin = muaaziqbal.vip@gmail.com (email_verified)
scripts/           # dev-server.mjs (0.0.0.0:3000), self-test.mjs, generate-streams.mjs
vercel.json        # rewrites: /get.php /xmltv.php /player_api.php /portal.php /live/:u/:p/:f /s/:token /pricing …
```

---

## 👤 Credits

- **Founder, Lead Developer & Architect:** **Muaaz Iqbal** — Kasur, Punjab, Pakistan
- **Ecosystem:** [Mizanora Projects](https://mizanora.vercel.app) • Org: [github.com/Mizanora-org](https://github.com/Mizanora-org)
- **PRO VIP / Support:** 0306-2015326 ([WhatsApp](https://wa.me/923062015326))
- System architecture inspired by the sibling project `BarakatWave-TV` (same owner), rebuilt & rebranded as **Mizanora IPTV** on Firebase project `mizanoranet`.
