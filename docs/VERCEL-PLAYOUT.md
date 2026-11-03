# Vercel-native HLS playout (v6.1)

## The actual playback chain

```text
Xtream / M3U / MAG live URL
  → authenticated signed resolver
  → /playout/<signed-session>/index.m3u8
  → four bundled intro segments (8 seconds)
  → discontinuity → source MPEG-TS media segments
  → source failure/stall → discontinuity → offline live loop
  → healthy advancing source → discontinuity → live again
```

Authenticated expired live links use the recharge loop. Metadata-only movies/episodes use the coming-soon loop. These generated playlists have increasing media-sequence values and **no `EXT-X-ENDLIST`**. The bundled eight-second files are repeatedly scheduled as a live broadcast, with discontinuities when timestamps restart. An actual configured movie/episode remains direct VOD playback.

This runs as ordinary short-lived Vercel functions. Vercel returns the text manifest; video segments are fetched directly from the provider or the bundled static CDN files. No FFmpeg process, VPS or continuously running Node server is required for this path. The optional encoder gateway is a separate override when `MZ_GATEWAY_URL` and its secret are configured.

## Enable on Vercel

1. Configure the existing Firebase service account and strong `MZ_STREAM_SECRET` / `MZ_SESSION_SECRET`. Production requires durable server writes, not a `/tmp` mirror.
2. Publish `firebase/database.rules.json`. The new `hlsSessions` node is private and has an `expires` index for bounded cleanup; service-account access is required.
3. Deploy the branch's code/assets and rewrites. `api/stream.js` has a 60-second function limit for bounded discovery/probes/transaction retries; it never holds a video-stream connection open.
4. Leave both optional `MZ_GATEWAY_*` variables unset to use this Vercel implementation rather than the separate encoder.
5. Admin → Settings → **Vercel HLS playout for external Xtream / MAG** is enabled by default. Save the setting explicitly when upgrading an existing installation. Enable welcome intro for the eight-second pre-roll.
6. Admin → **Broadcast Studio**: test a channel and each card, then inspect the actual media/discontinuity sequence. Private owner previews expire after 15 minutes. Do not share signed URLs/source credentials from the inspector.

Use HTTPS sources and verify redistribution rights. Generated manifests use `Cache-Control: no-store`; static bundled segment files remain CDN-served. Keep the `.ts` alias rewrites: the underlying existing files are `.m2ts`, but some external decoders reject that extension.

## How continuity is preserved

Each tune-in gets a random session and a signed capability. A small RTDB record tracks the next output segment number, upstream cursor, intro progress, loop cursor and discontinuity count. ETag/If-Match transactions serialize simultaneous refreshes across independent Vercel instances. The first intro segment is published immediately; the remaining intro segments become available across the intro window. `EXT-X-START` requests playback from the beginning.

Source media numbers are remapped to the output timeline. AES-128 keys keep explicit upstream-derived IVs, so changing the media sequence does not change decryption. Relative source/variant/key URLs are resolved against the final fetched playlist URL. The implementation resolves masters to a supported muxed AVC variant rather than treating a master as a media playlist.

Fallbacks retain increasing output sequence numbers; broken source URLs are removed when transitioning to offline/recharge. Short lookahead on the known loop clips keeps the next segments available. Windows are bounded to 18 output segments. Session lifetime is four hours; expired sessions are deleted opportunistically in bounded batches when new sessions start. Idle records can remain until expiry/cleanup but do not run a background process. Schedule additional database cleanup if your traffic/storage policy requires it.

## Failure and recovery

- Every live playlist refresh checks the upstream playlist and samples its latest segment with a bounded HTTP request.
- An HTTP failure, empty/unsupported manifest or failed sampled segment switches to offline.
- An unchanged source sequence for more than `max(20 seconds, 3 × target duration)` also switches to offline.
- New healthy source segments resume live without resetting the output media sequence.
- An expired subscription changes an existing playlist to recharge; a suspended/deleted account is denied. New expired Xtream/MAG logins remain disabled, so some apps will not request the recharge URL after login failure.
- Subscription checks follow the existing account-read/cache behavior, not immediate push notifications. Players can continue showing already-buffered media briefly.
- If an unavailable source later returns with a segment duration larger than the session's initial target duration, retune to establish a fresh target. The function does not mutate the target duration mid-playlist.

## Supported formats and honest limits

Supported: ordinary **muxed MPEG-TS HLS**, clear or AES-128, with segments up to 30 seconds. A compatible HLS VOD source used as a live channel can also rotate on its segment timeline.

Not remuxed/transcoded by Vercel: fMP4/EXT-X-MAP, byte ranges, low-latency partial playlists, separate audio renditions, DRM/SAMPLE-AES, DASH, raw continuous TS and arbitrary MP4 inputs. These produce an explicit compatibility failure/offline card in HLS mode. Turn off serverless HLS for direct playback, or use a real transcoder where needed. Source codecs, audio layout, resolution transitions and player discontinuity support still affect interoperability. Do not promise every firmware will honor the same start position or recover identically.

Segments and encryption keys remain direct provider requests. Provider CORS can block browser Studio playback even when external IPTV apps work. A segment may also fail after the server's sample; this implementation cannot detect every client-side network/decoder error. It probes one current segment, not the entire feed.

The serverless package uses the four bundled H.264/AAC cards. **It does not dynamically burn channel/payment text into frames.** The playlist includes a channel title; the website supplies dynamic overlays. Rebuild bundled videos when their baked owner contact/payment details change. Per-reseller burned-in video needs pre-rendered assets or the optional encoder. Custom website MP4 URLs do not automatically become serverless segmented cards.

## Verification performed locally

```sh
npm test
FFMPEG=/path/to/ffmpeg npm run test:playout
```

Coverage includes parser restrictions, master/relative URI resolution, AES IV preservation, exactly eight seconds of intro, repeated/concurrent refreshes, monotonic sequence transitions, source/segment failure, frozen sources, recovery, expiry/recharge, suspension denial, private previews, bounded windows and expired-record cleanup. The optional FFmpeg step actually decodes a captured intro-plus-source playlist using real MPEG-TS fixtures.

Local Chromium checks also exercise owner login, desktop/mobile layout and actual HLS card playback. Production Vercel/Firebase transactions, your licensed live feeds, CORS and physical MAG firmware still need deployment-environment testing. No production deployment is implied by local tests.

## Cost and operations

Every active viewer polls manifests and incurs function/database/source-probe requests. ETAG transactions perform remote reads and conditional writes; contention retries and upstream errors add latency. Monitor Vercel durations/errors, Firebase bandwidth/transaction traffic and source limits before customer rollout. This implementation has no global per-account concurrent-viewer enforcement or distributed bitrate scheduler. Existing API rate limits are not a substitute for deployment-level abuse controls and load testing.
