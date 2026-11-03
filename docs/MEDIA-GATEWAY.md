# Optional external-player media gateway

> v6.1 also includes [Vercel-native manifest playout](VERCEL-PLAYOUT.md), enabled by default for compatible MPEG-TS HLS. This gateway is optional for actual transcoding, not a prerequisite for intro injection.

## What is implemented

The Node/FFmpeg worker in `gateway/` is an opt-in stateful HLS transcoder for authenticated live Xtream/MAG streams. With the gateway configured, existing `/live/...` URLs redirect through a signed start ticket. The worker:

1. Obtains the current source, channel identity, payment card and subscription authorization from the app over a private server-to-server header.
2. Transcodes the bundled welcome video for eight seconds, burning the selected channel name/number and configured owner/reseller payment/contact text into the video.
3. Appends the live source to the same rolling HLS playlist with a discontinuity boundary.
4. Switches to the bundled offline loop if the source exits/fails or stops producing segments. Retune the channel to retry the source.
5. Rechecks the subscription approximately every 20 seconds (plus request timeout), stopping revoked/expired sessions. Sessions also expire after four hours; retune for a fresh session.
6. Stops idle sessions after 90 seconds without playlist/segment requests and removes their temporary files. Per-process capacity defaults to four simultaneous viewers.

The website's public player continues using its own intro and direct playback, avoiding a second intro. Movies and series remain direct source playback. Expired-account recharge handling remains in the existing Xtream handler.

This is an implementation tested locally with real FFmpeg, **not a deployed or load-certified streaming service**. A physical MAG device, your licensed upstream feeds and your production reverse proxy still require acceptance testing. `/c/` is a setup landing page, not a full Ministra TV UI.

## Infrastructure and security requirements

- Dedicated Linux VPS with Node 22, FFmpeg including libx264/drawtext/AAC, DejaVu fonts and HTTPS termination, or Docker Compose.
- Each viewer gets a separate 720p transcode. Benchmark CPU and network before raising capacity. Do not deploy this worker to Vercel/serverless functions.
- Configure only owner-controlled, trusted source origins. `MZ_SOURCE_ORIGINS` checks the initial source origin; FFmpeg itself follows provider redirects and nested playlist URLs. **It is not a network sandbox.** Before production, apply host/container egress firewall rules denying loopback/private/link-local/cloud-metadata destinations and restrict outbound traffic to approved feed/CDN and app destinations. Do not ingest arbitrary/untrusted playlists. DNS/CDN changes need an operational allowlist update.
- Use a dedicated host/container with no cloud instance credentials or internal network access. Docker drops capabilities and runs read-only as non-root, but those settings do not replace the egress firewall.
- Gateway source inputs permit only HTTP(S)/TCP/TLS/crypto protocols, not local file references. Source credentials must use the URL query rather than URL userinfo.
- The app↔gateway secret must be random, at least 32 characters, and different from session/stream secrets. Store it in deployment secret settings, never Git or browser code.
- HLS session URLs are unguessable bearer capabilities. Do not log query strings or session URLs in public analytics. Disable proxy caching on `/start` and `/hls/`; cookies are not required.
- Single-node in-memory sessions: restarts require retuning. Multiple gateway replicas need sticky routing for `/start` and `/hls/`; no distributed scheduler is included.

## Deploy the worker first

Generate a secret securely on the VPS (do not paste it into chat):

```sh
openssl rand -hex 32
```

Set these variables in a protected environment file **outside Git**, then use Docker Compose's `--env-file` option:

```dotenv
MZ_GATEWAY_SECRET=<generated secret>
MZ_APP_ORIGINS=https://your-app.example
MZ_SOURCE_ORIGINS=https://your-app.example,https://licensed-provider.example
MZ_GATEWAY_MAX_SESSIONS=4
```

Include the application origin in source origins for bundled standby videos. Origins must be exact, comma-separated, without trailing slashes. Do not enable insecure HTTP in production; the test harness alone uses an explicit test option.

```sh
docker compose --env-file /secure/path/media.env -f gateway/compose.yaml up -d --build
```

Point an HTTPS reverse proxy at `127.0.0.1:8080`. Example Nginx location inside your certificate-enabled `server` block:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 30s;
    proxy_cache off;
}
```

The service itself binds `0.0.0.0`; Compose intentionally publishes only the VPS loopback port, behind TLS. Verify `https://media.your-domain.example/health`. Add monitoring for container restarts, CPU, memory, network and rejected-capacity responses.

## Enable app routing last

In the app's server environment, configure:

```dotenv
MZ_GATEWAY_URL=https://media.your-domain.example
MZ_GATEWAY_SECRET=<the same private secret>
```

Redeploy/restart the app. Both variables are required; partial or insecure production configuration fails closed rather than silently bypassing the gateway. New authenticated live stream links now use it. Rollback: remove **both** variables and redeploy; existing gateway sessions finish/expire separately.

## Verification

```sh
npm test
FFMPEG=/path/to/ffmpeg npm run test:gateway
```

The second suite starts isolated local HTTP fixtures and the actual gateway, decodes an intro MPEG-TS segment with FFmpeg, checks transition to a live source and offline loop, validates discontinuities and tests ticket rejection, source allowlisting, capacity, authorization revocation and session cleanup. It requires FFmpeg and fonts. No external paid feed is contacted.

Before enabling customers:

- Verify the first eight seconds in VLC and each supported MAG/TV app; some players choose a different live start position or buffer longer. Do not promise universal timing across arbitrary firmware.
- Test a known-good live HLS source, a silent/no-audio source, an outage, a stalled feed and a source with redirects/CDN segments.
- Suspend a test client during playback and confirm it stops within the authorization interval plus any already buffered media.
- Confirm dynamic payment details, EPG/channel order, renewal and retuning after four hours.
- Load-test at intended concurrency and confirm source redistribution/transcoding rights.

No production domain, VPS or device was configured by the implementation tests. Deployment requires your infrastructure administrator to perform the above steps.
