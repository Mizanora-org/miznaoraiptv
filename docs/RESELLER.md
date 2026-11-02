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
