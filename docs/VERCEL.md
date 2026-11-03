# Vercel + Firebase deployment checklist

## 1. Project settings

- Framework Preset: **Other**
- Root Directory: repository root
- Install Command: `npm install`
- Build Command: blank (there is no build script)
- Output Directory: `public` if Vercel asks for one
- Node.js: **20 or newer**
- Keep `vercel.json`; it contains API/protocol/page rewrites and headers.

## 2. Environment variables

Open **Vercel → Project → Settings → Environment Variables**.

| Name | Value |
|---|---|
| `FIREBASE_DATABASE_URL` | `https://mizanoranet-default-rtdb.firebaseio.com` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Complete Firebase service-account JSON, marked Sensitive |
| `MZ_OWNER_PIN` | New private owner PIN |
| `MZ_SESSION_SECRET` | Random 32+ character secret |
| `MZ_STREAM_SECRET` | A different random 32+ character secret |

The service-account JSON can be generated at **Firebase Console → Project settings → Service accounts → Generate new private key**. Paste the complete JSON value only in Vercel; never commit it or share it publicly.

Alternative to the single JSON variable:

- `FIREBASE_CLIENT_EMAIL` = the JSON `client_email` value.
- `FIREBASE_PRIVATE_KEY` = the JSON `private_key` value without the outer JSON quotes, including `-----BEGIN PRIVATE KEY-----`, `-----END PRIVATE KEY-----` and the complete encoded body/newlines.

Do not set `PORT`, `HOST`, `MZ_RTDB_MIRROR` or `MZ_RTDB_OFFLINE` on Vercel. The public Firebase API key is already in the repository.

## 3. Firebase console

1. Ensure the Realtime Database exists at the configured URL.
2. Publish `firebase/database.rules.json`.
3. Enable **Authentication → Google**.
4. Add the Vercel preview/production domains and custom domain under **Authentication → Settings → Authorized domains**.
5. Keep owner Google email `muaaziqbal.vip@gmail.com` verified.

## 4. Deploy and verify

Redeploy after changing variables, then verify:

```text
https://YOUR_DOMAIN/api/embed?action=health
```

Expected signals:

```json
{
  "configuredServiceAccount": true,
  "durableServerWrites": true
}
```

Then check `/`, `/admin`, `/reseller`, `/developers`, a trial, a channel save and EPG import. Failed production Firebase writes deliberately return an error instead of pretending a temporary file is durable storage.

## Import notes

Vercel request-size limits can be lower than the application's parser limits. For large M3U/XMLTV documents, prefer remote HTTPS import over uploading through a serverless request. Remote imports have timeout, size, redirect and production private-network guards.


## Vercel-native intro and fallback playout (v6.1)

See [VERCEL-PLAYOUT.md](VERCEL-PLAYOUT.md). Compatible live HLS now uses Vercel manifest stitching by default, without the optional VPS encoder. Publish the updated Firebase rules (`hlsSessions` expiry index), configure service-account credentials, and test Admin → Broadcast Studio after deployment.
