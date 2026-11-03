# Playback reliability investigation — v6.1.1

## Scope of the finding

The reported production symptom was “every active channel shows offline after the intro.” The changes below address reproducible causes in the code. We did not have a production trace or unrestricted access to the user's provider feeds, so this is not a claim that one specific provider failure was confirmed remotely.

## Research applied

RFC 8216 requires a stable target duration and validates EXTINF durations rounded to the nearest integer, not rounded up. It also specifies playlist reload timing and retaining sufficient live media; overly short startup windows can stall players. This motivated using the declared target duration, publishing playable media upfront and retaining enough window duration. [1](https://www.rfc-editor.org/info/rfc8216/)

A provider master playlist carries adaptation/rendition information. Preserving the original master rather than rejecting separate-audio variants allows the client to use its supported renditions. It does not make incompatible codecs or DRM universally playable. [2](https://rfc-editor.org/rfc/rfc8216)

The official hls.js API documents bounded buffers, live-sync settings and recovery controls. The website now gives recognized network/media errors bounded recovery attempts before replacing playback with the offline video. Reference: https://github.com/video-dev/hls.js/blob/master/docs/API.md . We keep conservative three-segment live sync rather than claiming that a smaller buffer is always smoother.

## Confirmed code defects and corrections

| Previous behavior | Correction |
| --- | --- |
| Target inferred with `ceil(max EXTINF)` | Respect declared target and RFC nearest-integer validation; 6.004 seconds does not incorrectly change target 6 to 7 |
| Every reload probes the newest segment from Vercel | Remove the blocking probe; server-only Range/geolocation restrictions are not a reliable client availability check |
| fMP4/separate audio/non-HLS/unsupported encryption becomes offline | Preserve original source; source licensing, decoder and DRM support remain the player's responsibility |
| First media response contains only one 2-second intro segment | Publish all intro segments and available live media in playback order for startup buffering |
| Every reload resolves the master again | Pin the rendition, coalesce concurrent discoveries and cache for 1.5 seconds; rediscover the master on rendition failure |
| Only last three new segments appended after a slow reload | Append available unseen segments up to the bounded window; flag genuine gaps/restarts with a discontinuity |
| Signature changes in an existing segment URL cause duplicate output | Track source media sequence, not rotating URL tokens, for advancement |
| One manifest error immediately replaces live playback | Retain a healthy buffer during a bounded retry grace period; sustained failures/frozen sequences still use offline |
| Four-hour expiry cuts ongoing sessions | New capabilities last seven days; active records renew a six-hour idle expiry, with subscription checks and password-change revocation |
| Empty EPG when no source data exists | Generate clearly labelled availability notices in gaps; real programmes are retained and not overwritten |

## Compatibility priorities

1. **Auto**: use branded stitching for compatible muxed MPEG-TS HLS; otherwise return the original provider URL.
2. **Direct**: Admin → Channels → edit → Playback compatibility. Use for a channel whose codec transition or device behavior is incompatible with the intro. Original adaptive streaming is retained and the external intro is skipped.
3. **Encoder**: use only where actual codec/container conversion or burned-in dynamic graphics are required.

Neither Direct mode nor redirect-based compatibility can monitor the device after it leaves the app. In those modes, subscription/recharge checks happen at the app entry point; an already-open upstream stream is controlled by the provider/player. Auto mode must not disguise an incompatible but active channel as offline merely to keep an intro.

Server-only HTTP 401/403/429 triggers original-source compatibility. This is not circumvention of provider authentication; a device denied by the provider will still be denied.

## EPG behavior

Public guide, Xtream short EPG/MAG short guide and XMLTV now expose gaps as **Schedule unavailable**, with a description saying explicitly that it is not a programme name. XMLTV channel IDs match playlist declarations. The next 48 hours are covered by generated notices where imported data is absent. These notices do not prove stream availability and are not invented schedules. Import/update a legitimate XMLTV source to show actual programmes.

## Validation and remaining acceptance

Automated regressions cover target-duration fluctuations, request coalescing, unsupported-format passthrough, server-side access restrictions, delayed refreshes, URL-signature changes, credential revocation, retry grace, EPG gaps and an accelerated 72-hour timeline simulation. Optional FFmpeg tests decode real stitched transport-stream fixtures. Local Chromium was also exercised against a moving live fixture and a temporary manifest outage.

Before production acceptance, test representative authorized feeds in each supported client: VLC, relevant Smarters/TiviMate versions, actual MAG firmware, Safari native HLS and Chromium hls.js. Include slow networks, multi-day use, source credential expiry, device sleep/wake, channel changes, subscription expiry and provider restarts. These physical/device and production tests have not all been performed here.

Long-running support is a bounded capability, not a promise of zero buffering or universal compatibility. CDN bandwidth, provider playlists, signed URL TTLs, CORS, DRM, device memory and connection quality remain material constraints. Vercel and Firebase load/cost must also be measured at intended concurrency.
