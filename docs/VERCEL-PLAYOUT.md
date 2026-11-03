# Vercel-native HLS playout (v6.1.2)

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

Each tune-in gets a random session and a signed capability. A small RTDB record tracks the next output segment number, upstream cursor, intro progress, loop cursor and discontinuity count. ETag/If-Match transactions serialize simultaneous refreshes across independent Vercel instances. All four intro segments and available initial live segments are published upfront in playback order. This avoids starving clients while they wait for the next playlist reload. `EXT-X-START` requests playback from the beginning.

Source media numbers are remapped to the output timeline. AES-128 keys keep explicit upstream-derived IVs, so changing the media sequence does not change decryption. Relative source/variant/key URLs are resolved against the final fetched playlist URL. The implementation resolves masters to a supported muxed AVC variant rather than treating a master as a media playlist.

Fallbacks retain increasing output sequence numbers; broken source URLs are removed when transitioning to offline/recharge. Short lookahead on the known loop clips keeps the next segments available. Windows normally retain 18 segments, extending when needed to retain at least three target durations, with a hard cap of 90. Playback capabilities last seven days; active session records renew a six-hour idle expiry (never beyond the signed capability). Owner previews still last at most 15 minutes. Password changes invalidate new long-lived capabilities. Expired sessions are deleted opportunistically in bounded batches when new sessions start. Idle records can remain until expiry/cleanup but do not run a background process. Schedule additional database cleanup if your traffic/storage policy requires it.

## Failure and recovery

- Rendition discovery is pinned after success, with a bounded 1.5-second per-instance cache and concurrent request coalescing. A failed pinned rendition can be rediscovered through the master.
- Per-refresh segment probes have been removed. A server-side Range request being denied is not evidence that the client cannot play that feed.
- A healthy session retains its buffered media through temporary manifest fetch failures for `max(15 seconds, 3 × target duration)`. Sustained failures then switch to offline. An initially unavailable source may show standby sooner because no healthy source buffer exists.
- An unchanged media sequence for more than `max(30 seconds, 4 × target duration)` also switches to offline.
- Unsupported stitching formats and server-side HTTP 401/403/429 preserve the original provider URL rather than producing a false offline card. This does not bypass the provider's own authorization.
- New healthy source segments resume live without resetting the output media sequence.
- An expired subscription changes an existing playlist to recharge; a suspended/deleted account is denied. New expired Xtream/MAG logins remain disabled, so some apps will not request the recharge URL after login failure.
- Subscription checks follow the existing account-read/cache behavior, not immediate push notifications. Players can continue showing already-buffered media briefly.
- Declared target duration is preserved, with RFC-rounded segment duration validation. A genuine incompatible target change hands playback to the original provider instead of mutating the target mid-playlist or declaring the channel offline.

## Supported formats and honest limits

Supported: ordinary **muxed MPEG-TS HLS**, clear or AES-128, with segments up to 30 seconds. A compatible HLS VOD source used as a live channel can also rotate on its segment timeline.

Not remuxed/transcoded by Vercel: fMP4/EXT-X-MAP, byte ranges, low-latency partial playlists, separate audio renditions, DRM/SAMPLE-AES, DASH, raw continuous TS and arbitrary MP4 inputs. These automatically use original-source playback, without the external intro stitch. Admin → Channels → Edit → Playback compatibility can also force Direct mode for an individual channel. The player still needs support/licensing for that source; the app does not remove DRM. Source codecs, audio layout, resolution transitions and player discontinuity support still affect interoperability. Do not promise every firmware will honor the same start position or recover identically.

Segments and encryption keys remain direct provider requests. Provider CORS can block browser Studio playback even when external IPTV apps work. The server no longer samples every segment. Segment-only failures and client-specific decoding failures cannot reliably be inferred from a successful manifest fetch. The website has bounded network/media recovery attempts, but third-party players control their own error recovery.

The serverless package uses the four bundled H.264/AAC cards. **It does not dynamically burn channel/payment text into frames.** The playlist includes a channel title; the website supplies dynamic overlays. Rebuild bundled videos when their baked owner contact/payment details change. Per-reseller burned-in video needs pre-rendered assets or the optional encoder. Custom website MP4 URLs do not automatically become serverless segmented cards.

## Verification performed locally

```sh
npm test
FFMPEG=/path/to/ffmpeg npm run test:playout
```

Coverage includes parser restrictions, master/relative URI resolution, AES IV preservation, exactly eight seconds of intro, repeated/concurrent refreshes, monotonic sequence transitions, source/segment failure, frozen sources, recovery, expiry/recharge, suspension denial, private previews, bounded windows and expired-record cleanup. The optional FFmpeg step actually decodes a captured intro-plus-source playlist using real MPEG-TS fixtures.

Local Chromium checks also exercise owner login, desktop/mobile layout and actual HLS card playback. Production Vercel/Firebase transactions, your licensed live feeds, CORS and physical MAG firmware still need deployment-environment testing. No production deployment is implied by local tests.

## Cost and operations

Every active viewer polls manifests and incurs function/database/manifest-fetch requests. ETAG transactions perform remote reads and conditional writes; contention retries and upstream errors add latency. Monitor Vercel durations/errors, Firebase bandwidth/transaction traffic and source limits before customer rollout. This implementation has no global per-account concurrent-viewer enforcement or distributed bitrate scheduler. Existing API rate limits are not a substitute for deployment-level abuse controls and load testing.


## Compatibility and long-session acceptance (6.1.1)

- Every requested XMLTV/short-EPG channel now receives explicitly labelled “Schedule unavailable” notices for gaps in the next 48 hours. Imported programme data wins; no programme names are invented. Notices are generated on read, not stored as real guide data.
- Direct compatibility mode preserves provider adaptive variants/audio/subtitles, but cannot enforce server-side intro/fallback/recharge behavior after the redirect. Provider URL expiry, geoblocks and codec support still apply.
- Seven-day capability life is not an uninterrupted-playback guarantee. Network outages, provider restarts, upstream signed-URL expiry, device memory and Vercel/Firebase availability remain external constraints. Retune after capability expiry or six hours without activity.
- Tests include an accelerated **72-hour timeline simulation** with monotonically increasing sequence numbers and bounded state. This is not a real three-day hardware soak or a production CDN load test.
- Browser checks in this revision used a local moving HLS fixture, playback beyond 28 seconds and a transient 4.5-second manifest outage. No decoder/page errors were reported in that check. Test actual providers and target devices before rollout.

Research and implementation rationale: see [PLAYBACK-RELIABILITY.md](PLAYBACK-RELIABILITY.md).


## Reconnect behavior (6.1.2)

A player that reconnects through its original Xtream/M3U URL no longer automatically creates another intro. For non-preview sessions, a server-secret HMAC of the authenticated account/credential version, source and request IP/user-agent scopes a resumable session. Raw IP/user-agent values are not persisted in the session. A reconnect within 120 seconds of the last playlist activity resumes the existing timeline; concurrent reconnects use the same transactional generation. After an idle interval, a new generation starts with one fresh intro and old-generation URLs return 410 instead of attaching to that new timeline.

The start-at-zero hint is only emitted during the intro window. Played intro segments are removed once the intro window has passed and at least three target durations of non-intro media are available. Removing the prefix preserves media and discontinuity sequence numbers. This also prevents a player reopening the final playout URL from being directed back to the bumper. Website Retry skips its own already-shown intro; explicitly choosing a channel still starts a normal introduction.

IP/user-agent identification is a reconnect heuristic, not a device identifier: two devices sharing an account, IP and user-agent may share the recent timeline, while an IP/user-agent change can create a new intro. Use separate accounts for independent simultaneous viewers. Owner Studio previews remain independent. The fix does not repair an unavailable upstream source or prove that a particular production/player reconnect was caused only by the intro logic.
