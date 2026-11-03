# Mizanora IPTV v6 operations

## Owner rollout

1. Configure persistent Firebase storage and server secrets as described in [VERCEL.md](VERCEL.md). A preview/local mirror is not a production database. Back up production data before rollout.
2. Open `/admin`. In settings, review service name, support WhatsApp, payment method, account number/title and business introduction. Existing configured contacts are retained; do not replace them with test values.
3. Click **Use new bundled videos + 8s intro**, then **Save settings** if existing database settings point at an old/custom video. All four repository video packages have already been replaced, not added alongside the old content. The default intro is eight seconds and non-skippable; existing owner overrides require this reset.
4. Import licensed M3U sources. Edit a channel to set its number, group, EPG ID and active/offline/inactive status. Channel number is distinct from immutable stream ID and playlist order. Use **Save sort to playlists** to publish ordering to clients.
5. Import XMLTV, open EPG mapping and select the source channel for each live channel. Auto-map only handles unique matches; review ambiguous entries manually. Refresh XMLTV as required; an imported file is not an automatically scheduled feed.
6. Source-check buttons perform a bounded server-side probe, not continuous monitoring or a guarantee of successful playback. A source can pass a manifest check and still have unavailable segments, unsupported codecs or browser CORS restrictions.
7. Movies and series may be metadata only. Add licensed stream URLs (per episode for series), filter playable entries and save catalog order. The public catalog directs viewers to their authenticated IPTV app; it does not implement authenticated browser VOD playback.
8. Create resellers, set login usernames/passwords and allocate credits. Owner resets invalidate prior sessions and rotate the automation API key; share the replacement securely.

## Reseller workflow

- Open `/reseller`; sign in using username/code and password or an automation key. The browser exchanges these for a 12-hour `mzs_` session in sessionStorage. Passwords are not persisted in browser storage.
- Use Account security to change username or password; provide the current password and confirm a new password. Password changes invalidate older sessions. The immutable reseller code remains the tenant identifier.
- Configure your business/payment card and share `/?reseller=YOUR_CODE`. Public branding exposes only intended contact/payment details, not credentials or credit balances.
- Create a client with username/password (or generated defaults), plan and optional MAG MAC. Renewals consume credits according to the plan; recording a payment is not automatically a second renewal unless extension months are selected.
- Edit a client to change username/password, MAC, name, contact or connections. Old playlist URLs stop working after credential changes. Share regenerated credentials through a private channel.
- API keys are intended for private backend automation, never publicly embedded JavaScript. Key rotation displays the new key once while keeping the browser session.

## MAG / Stalker

- Register a unique valid MAC on an active, unexpired client.
- Setup URL: `https://YOUR_HOST/c/`. Protocol: `/c/portal.php` or `/portal.php`.
- Supported actions include handshake, profile/main information, genres, ordered/all live channels, create_link, short EPG, watchdog and modules. Ordered lists support pagination, genre/search and name/number ordering.
- MAC-bound tokens are checked against the current account state; suspended/expired clients cannot continue using portal actions.
- `/c/` is a setup landing page, not the full Ministra TV browser UI. This is a lightweight live-TV compatibility implementation. Test your specific MAG firmware/app before selling compatibility; it does not implement full Ministra VOD, recording, catch-up or DRM.

## Playback and branding boundaries

The website plays the eight-second introduction and overlays the selected channel name/number and current payment/contact configuration. After the intro it attempts live playback. Player errors or a 20-second live-start watchdog display the offline video with retry/contact controls. Browser autoplay rules may require user interaction.

From v6.1, external live clients use [Vercel HLS playout](VERCEL-PLAYOUT.md) by default: compatible HLS is assembled with intro and live fallback loops. Turn off the serverless HLS setting for direct source redirects. The optional [encoder gateway](MEDIA-GATEWAY.md) is a separate transcoding path, not required for supported HLS manifest stitching.

The videos themselves carry the verified owner defaults. Dynamic reseller branding is a website overlay in direct mode. The optional gateway burns channel/payment/contact text into its introduction and offline frames. If owner payment details change, rebuild the video files too so the baked card matches the new settings.

## Rebuild video assets

```sh
python3 -m venv .venv
.venv/bin/pip install pillow imageio-ffmpeg
PYTHON=.venv/bin/python bash scripts/build-brand-videos.sh
```

Alternatively provide `FFMPEG=/path/to/ffmpeg` with Pillow installed. Optional environment variables: `MZ_PAYMENT_METHOD`, `MZ_PAYMENT_ACCOUNT`, `MZ_PAYMENT_TITLE`, `MZ_SUPPORT_NUMBER`. DejaVu fonts are used when installed. The builder produces 1280×720 H.264/AAC MP4, four two-second HLS segments and a JPEG poster for welcome/offline/recharge/cinema; it decodes each output before replacing the known generated files. It never deletes user uploads.

## Learning and verification

`/academy` offers 17 role-based lessons, checklists and quizzes. Progress is device-local browser storage, not audited staff certification or server-synced training records.

```sh
npm install
npm test
npm run dev
```

Before production: test real persistent storage, a real licensed live feed and EPG, desktop/mobile playback, the complete eight-second intro, offline recovery, reseller credential resets and the target MAG device. Automated API and jsdom tests do not replace device/browser/media-network testing.
