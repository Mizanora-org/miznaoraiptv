# Reseller panel and API

## Panel workflow

1. Owner creates a dealer at **Admin → Resellers → Create**, or a dealer registers at `/reseller` when self-service registration is enabled.
2. Save the dealer code and `mzr_` API key shown once. Login with code + password or API key.
3. Buy/top up credits through the support link; owner can also use **Admin → Resellers → Credits**.
4. Create a client with a plan. Server-side plan months determine credit cost.
5. Share credentials securely. MAG clients also need the portal URL and assigned MAC.
6. Use client actions for one-month renewal, suspension/reactivation, payment recording or deletion.
7. Configure retail prices and review the payment ledger. Rotate the API key immediately if it may have leaked.

Panel auth is stored in browser **sessionStorage**. Logout on shared devices. Client passwords are fetched only when explicitly requesting credentials.

## API authentication

```http
x-api-key: mzr_your_private_key
```

Alternatively, actions accept dealer `code` + `password` in the JSON body. Production integrations should prefer the API key in a backend environment variable.

## Common actions

- `reseller/me`, `reseller/stats`, `reseller/clients`
- `reseller/client-create`, `reseller/credentials`, `reseller/client-update`
- `reseller/client-renew`, `reseller/client-suspend`, `reseller/client-delete`
- `reseller/secure-link`
- `reseller/payment-record`, `reseller/finance`, `reseller/ledger`
- `reseller/pricing-set`, `reseller/key-rotate`

Example Node.js backend call:

```js
const response = await fetch("https://YOUR_DOMAIN/api/panel?action=reseller/clients", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.MZ_RESELLER_KEY
  },
  body: JSON.stringify({ action: "reseller/clients" })
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.error || "Request failed");
console.log(data.clients);
```

## Security and billing rules

- Never expose `mzr_` or owner `mzk_` keys in public JavaScript, mobile-app source or screenshots.
- Use **Browser → your backend → Mizanora API** for website integration.
- A dealer can mutate only clients belonging to its dealer code.
- Client-supplied amount, days or reseller code cannot override server plan/credit rules.
- Payment recording with extension months consumes one credit per month.
- Key rotation invalidates the old key immediately; update every backend using it.
- Public website channel embeds need no secret key; use `/embed.js` instead.

The complete machine-readable action index is available at `/api/panel?action=help`.

## Owner management and business tracking

Owner authentication (`mzk_` admin API key or owner session) is required for these actions:

| Action | Method | Purpose |
| --- | --- | --- |
| `admin/resellers` | GET | List reseller profiles, statuses and balances, without password/key hashes |
| `admin/reseller-create` | POST | Create a reseller; the API key is returned once |
| `admin/reseller-update` | POST | Update `name`, `email`, `whatsapp` or `status` (`active` / `suspended`) |
| `admin/credits-topup` | POST | Add a positive whole number of credits |
| `admin/reseller-report` | GET (`code`) or POST | Individual stats, finance, expiring clients and business events |

The owner can use **Admin → Resellers** for top-ups, reports and suspension/reactivation. Suspending a reseller disables their API and panel login; it does **not** suspend existing IPTV clients. The report does not contain client passwords. Business activity records include client creation, renewal, updates, suspension/deletion, payments, top-ups and key rotation when recorded by supported paths; older records without a reseller code cannot be attributed. This is not viewing, connection or playback tracking.

The reseller can call `reseller/report` or `reseller/activity` using their own key. Reports are automatically limited to that reseller. `reseller/clients` no longer returns passwords: use the authenticated `reseller/credentials` action for a specific owned client. The seven-day expiry list includes active, unexpired clients only.

### Connect your own website

Keep both the IPTV server URL and owner API key on **your website's backend** (e.g. Vercel server environment variables `IPTV_SERVER_URL` and `IPTV_ADMIN_KEY`). Authenticate and authorize your own website's staff before running a privileged action. This server-side function illustrates the upstream call; it is not a public route and does not implement your website's authentication:

```js
// Server-only. Never import this into browser code.
export async function getResellerReport(code) {
  const url = new URL('/api/panel', process.env.IPTV_SERVER_URL);
  url.searchParams.set('action', 'admin/reseller-report');
  url.searchParams.set('code', code);
  const response = await fetch(url, {
    headers: { 'x-api-key': process.env.IPTV_ADMIN_KEY },
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'IPTV API failed');
  return data.report;
}
```

For reseller-scoped operations use the appropriate reseller's `mzr_` key on the backend, never the owner key in a reseller-facing browser. Provision and store keys securely; validate each website user against the correct reseller before forwarding requests. This repository does not modify or deploy your separate `mizanora.vercel.app` website.

### Operational limitations

- Credits and account mutations currently span multiple RTDB writes and are **not transactional**. Concurrent create/renew/payment/top-up requests can race or leave partial results on failure. Serialize these operations externally and reconcile balances; do not rely on this as a production billing ledger until atomic transactions and idempotency are implemented.
- Existing rate limits are in-memory and per server instance, not a distributed abuse-prevention system. Public signup gives starter credits; add shared rate limiting and an approval/abuse-control process before exposing it at scale.
- The activity feed is a recent, best-effort business audit (up to 50 events per report), not a tamper-proof financial journal. No automatic notifications or real-time stream/concurrent-viewer monitoring are provided.
