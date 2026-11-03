/**
 * Mizanora IPTV — Panel API handler (fresh rebuild)
 *   /api/panel?action=… (GET)   /api/panel  POST {"action":…}
 * Sections: public • reseller (mzr_) • admin (owner Google token / mzp_ PIN / mzk_ key)
 */
import { handleOptions, parseBody, parseQuery, sendJson, getRequestBaseUrl, checkRateLimit, normalizeMac, isValidEmail, WA_LINK, WA_NUMBER, OWNER_EMAIL, signPayload, serverSecret } from "../_lib/util.js";
import { authenticateAdmin, authorizeReseller, createPinSession, createResellerSession, verifyBootstrapPin, upgradeResellerPassword } from "../_lib/auth.js";
import * as S from "../_lib/store.js";
import { fetchRemoteText, probeMediaUrl } from "../_lib/remote.js";

const portFor = (base) => Number(new URL(base).port || (new URL(base).protocol === "https:" ? 443 : 80));
async function importDocument(body, maxBytes) {
  const remoteUrl = String(body.url || "").trim();
  if (remoteUrl) return fetchRemoteText(remoteUrl, { maxBytes });
  return { text: String(body.content ?? body.text ?? ""), url: "", contentType: "text/plain" };
}

const PUBLIC_ACTIONS = new Set([
  "config", "plans", "help", "order", "order-status", "trial", "resolve", "track",
  "reseller/register", "reseller/login-password", "recharge/contact"
]);
const RESELLER_ACTIONS = new Set([
  "reseller/login", "reseller/profile-update", "reseller/me", "reseller/stats", "reseller/clients",
  "reseller/client-create", "reseller/credentials", "reseller/client-update",
  "reseller/client-renew", "reseller/client-suspend", "reseller/client-block",
  "reseller/client-delete", "reseller/secure-link", "reseller/key-rotate",
  "reseller/pricing-set", "reseller/payment-record", "reseller/finance", "reseller/ledger", "reseller/report", "reseller/activity"
]);
const ADMIN_ACTIONS = new Set([
  "admin/me", "admin/pin-login",
  "admin/xtream-accounts", "admin/xtream/create", "admin/xtream/update", "admin/xtream/renew",
  "admin/xtream/suspend", "admin/xtream/activate", "admin/xtream/delete",
  "admin/stalker/list", "admin/channels", "admin/channel-create", "admin/channel-update", "admin/channel-delete", "admin/channel-move", "admin/channel-sort", "admin/channel-reorder", "admin/channel-check", "admin/channels/import",
  "admin/epg-sources", "admin/epg-mapping", "admin/epg-map", "admin/epg-auto-map", "admin/epg-import", "admin/epg-refresh", "admin/epg-delete",
  "admin/playlists", "admin/playlist-save", "admin/playlist-delete", "admin/movie-update", "admin/series-update", "admin/catalog-sort",
  "admin/clients", "admin/client-create", "admin/client-renew", "admin/client-suspend", "admin/client-delete",
  "admin/resellers", "admin/reseller-create", "admin/reseller-update", "admin/reseller-report", "admin/credits-topup",
  "admin/orders", "admin/order-review", "admin/payments", "admin/trials",
  "admin/api-keys", "admin/api-key-create", "admin/api-key-revoke",
  "admin/settings", "admin/settings-set", "admin/analytics", "admin/audit", "admin/errors",
  "admin/secure-link"
]);

export default async function panelHandler(req, res) {
  if (handleOptions(req, res)) return;
  const rl = checkRateLimit(req, "panel", 300, 60_000);
  if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit exceeded" });

  const q = parseQuery(req);
  const isPost = req.method === "POST";
  if (!isPost && req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  // The action may exist only in the JSON body. Allow a bounded envelope for
  // documented file imports; M3U/XMLTV parsers still enforce 5 MB / 8 MB content.
  const body = isPost ? await parseBody(req, { maxBytes: 10_000_000 }) : {};
  const action = String(body.action || q.action || "").toLowerCase().trim();
  if (!action) return sendJson(res, 400, { ok: false, error: "Missing action" });
  const base = getRequestBaseUrl(req);

  try {
    /* ================= PUBLIC ================= */
    if (PUBLIC_ACTIONS.has(action)) {
      if (action === "config" || action === "plans") {
        return sendJson(res, 200, S.publicConfig(base), "public, max-age=120");
      }
      if (action === "help") {
        return sendJson(res, 200, helpDoc(base));
      }
      if (action === "track") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const trackRl = checkRateLimit(req, "analytics", 120, 60_000);
        if (!trackRl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit" });
        return sendJson(res, 202, await S.recordAnalyticsEvent(req, body));
      }
      if (action === "order") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const orderRl = checkRateLimit(req, "order", 12, 10 * 60_000);
        if (!orderRl.allowed) return sendJson(res, 429, { ok: false, error: "Too many orders. Please try again later." });
        if (!String(body.name || "").trim()) return sendJson(res, 400, { ok: false, error: "Name is required" });
        if (!isValidEmail(body.email)) return sendJson(res, 400, { ok: false, error: "Valid email is required" });
        if (String(body.whatsapp || "").replace(/\D/g, "").length < 10) return sendJson(res, 400, { ok: false, error: "Valid WhatsApp number is required" });
        const o = await S.createOrder(body);
        return sendJson(res, 201, {
          ok: true, order: o,
          message: `Order ${o.id} receive ho gaya. WhatsApp ${WA_NUMBER} par payment ka screenshot bhejein — jaldi activate hoga.`,
          whatsapp: WA_LINK
        });
      }
      if (action === "order-status") {
        const o = await S.getOrder(String(body.id || q.id || "").toUpperCase());
        if (!o) return sendJson(res, 404, { ok: false, error: "Order not found" });
        return sendJson(res, 200, { ok: true, order: { id: o.id, status: o.status, planId: o.planId, amount: o.amount, createdAt: o.createdAt, clientUsername: o.clientUsername || "" } });
      }
      if (action === "trial") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const trialRl = checkRateLimit(req, "trial", 8, 60 * 60_000);
        if (!trialRl.allowed) return sendJson(res, 429, { ok: false, error: "Too many trial attempts. Please try again later." });
        const r = await S.claimTrial(body);
        if (!r.ok) return sendJson(res, 409, r);
        return sendJson(res, 201, {
          ok: true, ...r,
          message: "🎁 1-day FREE trial active! Neeche apne Xtream credentials dekhein.",
          links: {
            m3u: `${base}/get.php?username=${r.client.username}&password=${r.client.password}&type=m3u_plus&output=m3u8`,
            epg: `${base}/xmltv.php?username=${r.client.username}&password=${r.client.password}`,
            playerApi: `${base}/player_api.php?username=${r.client.username}&password=${r.client.password}`
          }
        });
      }
      if (action === "resolve") {
        // A username alone must never disclose the account password or signed-in links.
        const u = String(body.username || q.username || "").toLowerCase();
        const suppliedPassword = String(body.password || q.password || "");
        const c = await S.getClient(u);
        if (!c || !suppliedPassword || c.password !== suppliedPassword) {
          return sendJson(res, 401, { ok: false, error: "Valid username and password required" });
        }
        return sendJson(res, 200, {
          ok: true,
          username: c.username,
          status: c.status, expired: c.expired, daysLeft: c.daysLeft,
          mac: c.mac || undefined,
          links: {
            m3u: `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=m3u8`,
            epg: `${base}/xmltv.php?username=${c.username}&password=${c.password}`,
            playerApi: `${base}/player_api.php?username=${c.username}&password=${c.password}`,
            magPortal: c.mac ? `${base}/portal.php` : undefined
          }
        });
      }
      if (action === "reseller/register") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        if (!S.SELF_SERVE.enabled) return sendJson(res, 403, { ok: false, error: "Self-serve registration closed. WhatsApp " + WA_NUMBER });
        const rl2 = checkRateLimit(req, "reseller_register", 6, 10 * 60_000);
        if (!rl2.allowed) return sendJson(res, 429, { ok: false, error: "Too many attempts. 10 min baad try karein." });
        const email = String(body.email || "").toLowerCase().trim();
        if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, error: "Valid email required" });
        if (String(body.password || "").length < 8) return sendJson(res, 400, { ok: false, error: "Password must contain at least 8 characters" });
        const existing = (await S.listResellers()).find((r) => r.email === email);
        if (existing) return sendJson(res, 409, { ok: false, error: "Is email se pehle se reseller account hai — login karein.", code: existing.code });
        const created = await S.createReseller({ ...body, email, credits: S.SELF_SERVE.signupCredits });
        return sendJson(res, 201, {
          ok: true,
          message: `Welcome ${created.name || "Dealer"}! Aapka reseller panel ready hai — ${created.credits} free starter credits mile.`,
          reseller: { ...S.resellerPublic(created), apiKey: created.apiKey, code: created.code },
          resellerToken: createResellerSession(created), expiresIn: 12 * 3600,
          panelUrl: `${base}/reseller`
        });
      }
      if (action === "reseller/login-password") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const r = await authorizeReseller(req, body);
        if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
        if (r.via === "password") await upgradeResellerPassword(r.reseller.code, String(body.password));
        await S.updateReseller(r.reseller.code, { lastLoginAt: new Date().toISOString() });
        return sendJson(res, 200, { ok: true, reseller: S.resellerPublic(await S.getResellerByCode(r.reseller.code)), resellerToken: createResellerSession(r.reseller), expiresIn: 12 * 3600, panelUrl: `${base}/reseller` });
      }
      if (action === "recharge/contact") {
        const username = String(body.username || q.username || "").toLowerCase();
        const c = await S.getClient(username);
        if (!c) return sendJson(res, 404, { ok: false, error: "Account not found" });
        const r = c.resellerCode ? await S.getResellerByCode(c.resellerCode) : null;
        return sendJson(res, 200, {
          ok: true,
          whatsapp: r?.whatsapp ? `https://wa.me/${String(r.whatsapp).replace(/\D/g, "")}` : WA_LINK,
          whatsappNumber: r?.whatsapp || WA_NUMBER,
          resellerName: r?.name || "Mizanora Support",
          message: `${r?.name || "Mizanora"} se recharge karein — ya owner WhatsApp ${WA_NUMBER}`
        });
      }
    }

    /* ================= RESELLER ================= */
    if (RESELLER_ACTIONS.has(action) || action.startsWith("reseller/")) {
      const mutating = new Set(["reseller/client-create", "reseller/client-update", "reseller/client-renew", "reseller/client-suspend", "reseller/client-block", "reseller/client-delete", "reseller/key-rotate", "reseller/profile-update", "reseller/pricing-set", "reseller/payment-record"]);
      if (mutating.has(action) && !isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
      const auth = await authorizeReseller(req, body);
      if (!auth.ok) return sendJson(res, auth.status, { ok: false, error: auth.error });
      const R = auth.reseller;
      const owned = async (username) => {
        const t = await S.getClient(username);
        if (!t || t.resellerCode !== R.code) return null;
        return t;
      };
      const clientLinks = (base, c) => ({
        m3u: `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=m3u8`,
        epg: `${base}/xmltv.php?username=${c.username}&password=${c.password}`,
        playerApi: `${base}/player_api.php?username=${c.username}&password=${c.password}`,
        magPortal: c.mac ? `${base}/c/` : undefined,
        xtream: { host: base, port: portFor(base), username: c.username, password: c.password }
      });

      if (action === "reseller/login" || action === "reseller/me" || action === "reseller/stats") {
        if (action === "reseller/login") await S.updateReseller(R.code, { lastLoginAt: new Date().toISOString() });
        const clients = await S.listClients({ resellerCode: R.code });
        const stats = S.resellerStats(clients);
        const pricing = R.pricing || {};
        return sendJson(res, 200, {
          ok: true,
          reseller: S.resellerPublic(R),
          ...(action === "reseller/login" ? { resellerToken: createResellerSession(R), expiresIn: 12 * 3600 } : {}),
          stats: { ...stats, retailValue: stats.active * (Number(pricing.monthly) || S.PANEL.directPerUserMonthly) },
          finance: await S.resellerFinance(R.code),
          selfServe: { enabled: S.SELF_SERVE.enabled, signupCredits: S.SELF_SERVE.signupCredits, unitCost: S.SELF_SERVE.unitCost, pricePresets: S.SELF_SERVE.pricePresets, allowMacClients: S.SELF_SERVE.allowMacClients },
          clients: clients.map((c) => ({ ...c, password: undefined })),
          xtream: { serverUrl: base, m3uPlus: `${base}/get.php?username=USER&password=PASS&type=m3u_plus&output=m3u8`, epg: `${base}/xmltv.php?username=USER&password=PASS` }
        });
      }
      if (action === "reseller/clients") {
        const clients = await S.listClients({ resellerCode: R.code });
        return sendJson(res, 200, { ok: true, count: clients.length, clients: clients.map(({ password, ...client }) => client) });
      }
      if (action === "reseller/report") return sendJson(res, 200, { ok: true, report: await S.resellerReport(R.code) });
      if (action === "reseller/activity") return sendJson(res, 200, { ok: true, activity: await S.resellerActivity(R.code) });
      if (action === "reseller/client-create") {
        let plan = S.getPlan(body.planId) || S.PLANS.find((p) => p.id === "monthly");
        if (plan.id === "trial-1d") plan = S.PLANS.find((p) => p.id === "monthly");
        const creditCost = Math.max(1, Number(plan.months) || 1);
        if (Number(R.credits || 0) < creditCost) {
          return sendJson(res, 402, { ok: false, error: `${creditCost} credits required for ${plan.name}. JazzCash ${WA_NUMBER} par top-up karein.` });
        }
        let mac = "";
        if (body.mac) {
          if (!S.SELF_SERVE.allowMacClients) return sendJson(res, 403, { ok: false, error: "MAC/Stalker clients disabled." });
          mac = normalizeMac(body.mac);
          if (!mac) return sendJson(res, 400, { ok: false, error: "Invalid MAC (format 00:1A:79:XX:XX:XX)" });
          const all = await S.listClients();
          if (all.some((c) => c.mac && c.mac.toUpperCase() === mac)) return sendJson(res, 409, { ok: false, error: "Ye MAC pehle se registered hai." });
        }
        const created = await S.createClient({ ...body, planId: plan.id, days: plan.days, startTs: Math.floor(Date.now() / 1000), mac, resellerCode: R.code, source: mac ? "reseller-mac" : "reseller" });
        await S.updateReseller(R.code, { credits: Number(R.credits) - creditCost, creditsUsed: Number(R.creditsUsed || 0) + creditCost });
        const pricing = R.pricing || {};
        const collectAmount = Math.max(0, Number(body.collectAmount) || 0);
        const connectionFee = Math.max(0, Number(body.connectionFee ?? pricing.connectionFee ?? 0) || 0);
        let feeRecord = null;
        const amt = collectAmount > 0 ? collectAmount : connectionFee;
        if (amt > 0 && body.collectFee !== false) {
          const rec = await S.recordClientPayment({
            username: created.username, amount: amt,
            // createClient already set the full plan expiry; do not extend it twice.
            months: 0,
            via: body.via || "cash", note: collectAmount > 0 ? "Client sale (connection + plan)" : "Connection fee",
            resellerCode: R.code, recordedBy: "reseller"
          });
          feeRecord = rec.payment;
        }
        S.clearPanelCache();
        return sendJson(res, 200, {
          ok: true, client: created, creditsLeft: Number(R.credits) - creditCost, creditsUsed: creditCost, connectionFee: feeRecord,
          finance: await S.resellerFinance(R.code),
          stalker: mac ? { portalUrl: `${base}/c/`, mac, note: "MAG/Stalker box mein ye Portal URL + MAC daalein." } : undefined,
          sellPrice: { monthly: Number(pricing.monthly) || S.SELF_SERVE.monthlyDefault, connectionFee: Number(pricing.connectionFee) || S.SELF_SERVE.connectionFeeDefault },
          links: clientLinks(base, created)
        });
      }
      if (action === "reseller/credentials") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        return sendJson(res, 200, {
          ok: true,
          client: { ...t, password: undefined },
          credentials: { serverUrl: base, port: portFor(base), username: t.username, password: t.password, mac: t.mac || undefined, ...clientLinks(base, t) }
        });
      }
      if (action === "reseller/client-update") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const patch = {};
        for (const f of ["password", "email", "whatsapp", "name", "note"]) if (body[f] !== undefined) patch[f] = String(body[f]).slice(0, f === "note" ? 300 : 120);
        if (body.devices !== undefined) patch.devices = Math.max(1, Number(body.devices) || 1);
        if (body.mac !== undefined) {
          const mac = normalizeMac(body.mac);
          if (body.mac && !mac) return sendJson(res, 400, { ok: false, error: "Invalid MAC format." });
          if (mac) {
            const all = await S.listClients();
            const clash = all.find((c) => c.username !== t.username && c.mac && c.mac.toUpperCase() === mac);
            if (clash) return sendJson(res, 409, { ok: false, error: `MAC already on ${clash.username}` });
          }
          patch.mac = mac || "";
        }
        if (!Object.keys(patch).length && body.newUsername === undefined) return sendJson(res, 400, { ok: false, error: "Nothing to update." });
        let updated = await S.updateClient(t.username, patch);
        if (body.newUsername !== undefined && String(body.newUsername).toLowerCase() !== t.username) updated = await S.renameClient(t.username, body.newUsername);
        await S.pushAudit("client.updated", { resellerCode: R.code, username: updated.username });
        S.clearPanelCache();
        return sendJson(res, 200, { ok: true, client: updated });
      }
      if (action === "reseller/client-renew") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        let plan = S.getPlan(body.planId) || S.PLANS.find((p) => p.id === "monthly");
        if (plan.id === "trial-1d") plan = S.PLANS.find((p) => p.id === "monthly");
        const creditCost = Math.max(1, Number(plan.months) || 1);
        if (Number(R.credits || 0) < creditCost) return sendJson(res, 402, { ok: false, error: `${creditCost} credits required to renew ${plan.name}.` });
        const renewed = await S.renewClient(t.username, { planId: plan.id });
        await S.updateReseller(R.code, { credits: Number(R.credits) - creditCost, creditsUsed: Number(R.creditsUsed || 0) + creditCost });
        return sendJson(res, 200, { ok: true, client: renewed, creditsLeft: Number(R.credits) - creditCost, creditsUsed: creditCost });
      }
      if (action === "reseller/client-suspend" || action === "reseller/client-block") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const updated = await S.suspendClient(t.username, body.suspended !== false && body.blocked !== false);
        await S.pushAudit(updated.status === "suspended" ? "client.suspended" : "client.activated", { resellerCode: R.code, username: t.username });
        return sendJson(res, 200, { ok: true, client: updated });
      }
      if (action === "reseller/client-delete") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        await S.deleteClient(t.username);
        return sendJson(res, 200, { ok: true, deleted: t.username });
      }
      if (action === "reseller/secure-link") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const file = body.file || (await S.listChannels()).find((c) => c.status !== "inactive")?.id;
        if (!file) return sendJson(res, 404, { ok: false, error: "No channel available to sign." });
        return sendJson(res, 200, { ok: true, ...S.signStreamFor(base, t.username, file, body.kind || "live") });
      }
      if (action === "reseller/key-rotate") {
        const { generateResellerApiKey } = await import("../_lib/auth.js");
        const { hashApiKey } = await import("../_lib/auth.js");
        const newKey = generateResellerApiKey();
        await S.updateReseller(R.code, { apiKeyHash: hashApiKey(newKey) });
        await S.pushAudit("reseller.key_rotated", { resellerCode: R.code });
        S.clearPanelCache();
        return sendJson(res, 200, { ok: true, apiKey: newKey, note: "Purana mzr_ key foran invalid. Naya key ek dafa dikhta hai — save kar lo." });
      }
      if (action === "reseller/profile-update") {
        const supplied = body.patch || body;
        const changingPassword = supplied.newPassword !== undefined && supplied.newPassword !== "";
        if (changingPassword || supplied.username !== undefined) {
          const { verifyResellerPassword } = await import("../_lib/auth.js");
          if (!await verifyResellerPassword(R, String(body.currentPassword || ""))) return sendJson(res, 401, { ok: false, error: "Current password is required to change username or password." });
        }
        const credentialPatch = {};
        if (supplied.username !== undefined) credentialPatch.username = supplied.username;
        if (changingPassword) {
          if (supplied.newPassword !== supplied.confirmPassword) return sendJson(res, 400, { ok: false, error: "New passwords do not match." });
          credentialPatch.password = supplied.newPassword;
        }
        let updated = R;
        if (Object.keys(credentialPatch).length) updated = await S.setResellerCredentials(R.code, credentialPatch);
        const profile = {};
        for (const field of ["name", "whatsapp"]) if (supplied[field] !== undefined) profile[field] = String(supplied[field]).trim().slice(0, field === "name" ? 80 : 30);
        if (supplied.branding !== undefined) {
          const branding = { ...(R.branding || {}) };
          for (const field of ["paymentMethod", "paymentAccount", "paymentTitle", "tagline"]) {
            if (supplied.branding[field] !== undefined) branding[field] = String(supplied.branding[field]).trim().slice(0, field === "tagline" ? 160 : 80);
          }
          if (branding.paymentAccount && !/^[+0-9 ()-]{7,30}$/.test(branding.paymentAccount)) return sendJson(res, 400, { ok: false, error: "Invalid payment account number." });
          profile.branding = branding;
        }
        if (Object.keys(profile).length) updated = await S.updateReseller(R.code, profile);
        await S.pushAudit("reseller.profile_updated", { resellerCode: R.code, fields: Object.keys(profile) });
        return sendJson(res, 200, { ok: true, reseller: S.resellerPublic(updated), resellerToken: createResellerSession(updated), expiresIn: 12 * 3600, note: credentialPatch.password ? "Password updated. Other sessions were signed out." : "Profile saved." });
      }
      if (action === "reseller/pricing-set") {
        const current = R.pricing || {};
        const supplied = body.pricing || {};
        const pricing = { ...current };
        for (const key of ["monthly", "quarterly", "yearly", "connectionFee"]) {
          if (supplied[key] !== undefined) pricing[key] = Math.max(0, Math.min(1_000_000, Number(supplied[key]) || 0));
        }
        await S.updateReseller(R.code, { pricing });
        await S.pushAudit("reseller.pricing_updated", { resellerCode: R.code });
        return sendJson(res, 200, { ok: true, pricing: (await S.getResellerByCode(R.code)).pricing });
      }
      if (action === "reseller/payment-record") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const months = Math.max(0, Math.min(120, Math.floor(Number(body.months) || 0)));
        if (Number(R.credits || 0) < months) return sendJson(res, 402, { ok: false, error: `${months} credits required for this extension.` });
        const rec = await S.recordClientPayment({ ...body, months, username: t.username, resellerCode: R.code, recordedBy: "reseller" });
        if (months) await S.updateReseller(R.code, { credits: Number(R.credits) - months, creditsUsed: Number(R.creditsUsed || 0) + months });
        return sendJson(res, 200, { ...rec, creditsLeft: Number(R.credits) - months, creditsUsed: months });
      }
      if (action === "reseller/finance") return sendJson(res, 200, { ok: true, finance: await S.resellerFinance(R.code) });
      if (action === "reseller/ledger") return sendJson(res, 200, { ok: true, payments: await S.listPayments({ resellerCode: R.code }) });
      return sendJson(res, 400, { ok: false, error: "Unknown reseller action: " + action });
    }

    /* ================= ADMIN ================= */
    if (ADMIN_ACTIONS.has(action) || action.startsWith("admin/")) {
      // bootstrap: PIN login works without any prior auth
      if (action === "admin/pin-login") {
        const pinRl = checkRateLimit(req, "owner_pin", 8, 15 * 60_000);
        if (!pinRl.allowed) return sendJson(res, 429, { ok: false, error: "Too many PIN attempts. 15 min baad try karein." });
        if (!verifyBootstrapPin(body.pin)) {
          await S.pushAudit("pin.failed", { ip: req.headers["x-forwarded-for"] || "" });
          return sendJson(res, 401, { ok: false, error: "Invalid Owner PIN" });
        }
        const token = createPinSession();
        await S.pushAudit("pin.login", {});
        return sendJson(res, 200, { ok: true, token, expiresIn: 12 * 3600, note: "x-admin-token header mein bhejein" });
      }
      const admin = await authenticateAdmin(req);
      if (!admin.ok) return sendJson(res, admin.status || 401, { ok: false, error: admin.error });

      if (action === "admin/me") return sendJson(res, 200, { ok: true, admin: { email: admin.user.email, uid: admin.user.uid, via: admin.via }, owner: OWNER_EMAIL, brand: S.BRAND.name });
      if (action === "admin/xtream-accounts") {
        const xt = (await S.rtdbGetXtream?.()) || (await (await import("../_lib/rtdb.js")).rtdbGet("xtreamAccounts")) || {};
        const list = (Array.isArray(xt) ? xt : Object.values(xt)).map((a) => ({ ...a, password: a.password }));
        return sendJson(res, 200, { ok: true, count: list.length, accounts: list });
      }
      const xtream = async (fn) => fn(String(body.username || "").toLowerCase());
      if (action === "admin/xtream/create") return sendJson(res, 200, { ok: true, client: await S.createClient({ ...body, source: "admin" }) });
      if (action === "admin/xtream/update") {
        const t = await S.getClient(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Not found" });
        const supplied = body.patch || body;
        const patch = {};
        for (const field of ["password", "email", "whatsapp", "name", "note", "mac", "status"]) if (supplied[field] !== undefined) patch[field] = supplied[field];
        for (const field of ["devices", "expDate"]) if (supplied[field] !== undefined) patch[field] = Number(supplied[field]);
        let updated = await S.updateClient(t.username, patch);
        if (supplied.newUsername !== undefined && String(supplied.newUsername).toLowerCase() !== t.username) updated = await S.renameClient(t.username, supplied.newUsername);
        await S.pushAudit("client.updated", { username: updated.username, fields: Object.keys(patch) });
        return sendJson(res, 200, { ok: true, client: updated });
      }
      if (action === "admin/xtream/renew") {
        const t = await S.getClient(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Not found" });
        return sendJson(res, 200, { ok: true, client: await S.renewClient(t.username, { planId: body.planId || "monthly" }) });
      }
      if (action === "admin/xtream/suspend" || action === "admin/xtream/activate") {
        const client = await S.suspendClient(body.username, action.endsWith("suspend"));
        return client ? sendJson(res, 200, { ok: true, client }) : sendJson(res, 404, { ok: false, error: "Client not found" });
      }
      if (action === "admin/xtream/delete") { await S.deleteClient(body.username); return sendJson(res, 200, { ok: true, deleted: String(body.username || "").toLowerCase() }); }
      if (action === "admin/stalker/list") return sendJson(res, 200, { ok: true, clients: await S.listStalkerClients() });
      if (action === "admin/channels") {
        const channels = await S.listChannels();
        return sendJson(res, 200, { ok: true, count: channels.length, channels });
      }
      if (action === "admin/channels/import") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const importRl = checkRateLimit(req, "m3u_import", 20, 60_000);
        if (!importRl.allowed) return sendJson(res, 429, { ok: false, error: "Too many imports. Please retry shortly." });
        const document = await importDocument(body, 5_000_000);
        const result = await S.importChannels({ ...body, content: document.text, sourceUrl: document.url, name: body.name || body.filename });
        const epgImports = [];
        const epgErrors = [];
        if (body.importEpg === true || body.importEpg === "true") {
          for (const epgUrl of result.epgUrls.slice(0, 2)) {
            try {
              const epgDocument = await fetchRemoteText(epgUrl, { maxBytes: 8_000_000 });
              epgImports.push(await S.importEpg({ content: epgDocument.text, sourceUrl: epgDocument.url }));
            } catch (error) { epgErrors.push({ url: epgUrl, error: error.message }); }
          }
        }
        return sendJson(res, 200, { ok: true, ...result, epgImports, epgErrors });
      }
      if (action === "admin/epg-mapping") return sendJson(res, 200, { ok: true, ...await S.getEpgMapping() });
      if (action === "admin/epg-map") {
        const epg = await S.getEpgData();
        const epgId = String(body.epgId || "").trim();
        if (epgId && !epg.channels.some((c) => c.id === epgId)) return sendJson(res, 404, { ok: false, error: "XMLTV channel ID not found. Import its source first." });
        return sendJson(res, 200, { ok: true, channel: await S.updateChannel(body.id, { epgId }) });
      }
      if (action === "admin/epg-auto-map") return sendJson(res, 200, { ok: true, ...await S.autoMapEpg() });
      if (action === "admin/epg-sources") return sendJson(res, 200, { ok: true, sources: await S.listEpgSources() });
      if (action === "admin/epg-import") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const importRl = checkRateLimit(req, "epg_import", 20, 60_000);
        if (!importRl.allowed) return sendJson(res, 429, { ok: false, error: "Too many imports. Please retry shortly." });
        const document = await importDocument(body, 8_000_000);
        return sendJson(res, 200, { ok: true, ...await S.importEpg({ ...body, content: document.text, sourceUrl: document.url, name: body.name || body.filename }) });
      }
      if (action === "admin/epg-refresh") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const source = (await S.listEpgSources()).find((item) => item.id === body.id);
        if (!source) return sendJson(res, 404, { ok: false, error: "EPG source not found" });
        if (!source.url) return sendJson(res, 400, { ok: false, error: "Uploaded EPG has no remote URL to refresh." });
        const document = await fetchRemoteText(source.url, { maxBytes: 8_000_000 });
        return sendJson(res, 200, { ok: true, ...await S.importEpg({ content: document.text, sourceUrl: document.url, sourceId: source.id, name: source.name }) });
      }
      if (action === "admin/epg-delete") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        await S.deleteEpgSource(String(body.id || ""));
        return sendJson(res, 200, { ok: true, deleted: body.id });
      }
      if (action === "admin/channel-create") return sendJson(res, 201, { ok: true, channel: await S.createChannel(body) });
      if (action === "admin/channel-update") return sendJson(res, 200, { ok: true, channel: await S.updateChannel(body.id, body.patch || body) });
      if (action === "admin/channel-move") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        return sendJson(res, 200, { ok: true, channels: await S.moveChannel(body.id, Number(body.position)) });
      }
      if (action === "admin/channel-check") {
        const channel = (await S.listChannels()).find((c) => c.id === body.id);
        if (!channel) return sendJson(res, 404, { ok: false, error: "Channel not found" });
        let result;
        try { result = await probeMediaUrl(channel.url, base); }
        catch (error) { result = { online: false, error: error.message, checkedAt: new Date().toISOString() }; }
        await S.updateChannel(channel.id, { lastHealthCheck: result });
        return sendJson(res, 200, { ok: true, ...result, message: result.online ? `Source responded in ${result.latencyMs}ms. Player codec/CORS may still differ.` : `Source check failed: ${result.error || "HTTP " + result.httpStatus}. Mark Offline to show standby.` });
      }
      if (action === "admin/channel-sort") return sendJson(res, 200, { ok: true, channels: await S.sortChannels(body.mode) });
      if (action === "admin/channel-reorder") return sendJson(res, 200, { ok: true, channels: await S.reorderChannels(body.ids) });
      if (action === "admin/channel-delete") { await S.deleteChannel(body.id); return sendJson(res, 200, { ok: true, deleted: body.id }); }
      if (action === "admin/playlists") return sendJson(res, 200, { ok: true, playlists: await S.listPlaylists() });
      if (action === "admin/playlist-save") return sendJson(res, 200, { ok: true, playlist: await S.savePlaylist(body) });
      if (action === "admin/playlist-delete") { await S.deletePlaylist(body.id); return sendJson(res, 200, { ok: true, deleted: body.id }); }
      if (action === "admin/movie-update") return sendJson(res, 200, { ok: true, movie: await S.updateMovie(body.id, body.patch || body) });
      if (action === "admin/series-update") return sendJson(res, 200, { ok: true, series: await S.updateSeries(body.id, body.patch || body) });
      if (action === "admin/catalog-sort") return sendJson(res, 200, { ok: true, ...await S.sortCatalog(body.kind, body.mode) });
      if (action === "admin/clients") return sendJson(res, 200, { ok: true, count: (await S.listClients()).length, clients: await S.listClients() });
      if (action === "admin/client-create") return sendJson(res, 200, { ok: true, client: await S.createClient({ ...body, source: "admin" }) });
      if (action === "admin/client-renew") {
        const client = await S.renewClient(body.username, { planId: body.planId || "monthly" });
        return client ? sendJson(res, 200, { ok: true, client }) : sendJson(res, 404, { ok: false, error: "Client not found" });
      }
      if (action === "admin/client-suspend") {
        const client = await S.suspendClient(body.username, body.suspended !== false);
        return client ? sendJson(res, 200, { ok: true, client }) : sendJson(res, 404, { ok: false, error: "Client not found" });
      }
      if (action === "admin/client-delete") { await S.deleteClient(body.username); return sendJson(res, 200, { ok: true }); }
      if (action === "admin/resellers") return sendJson(res, 200, { ok: true, resellers: await S.listResellers() });
      if (action === "admin/reseller-create") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const r = await S.createReseller(body);
        return sendJson(res, 201, { ok: true, reseller: { ...S.resellerPublic(r), apiKey: r.apiKey, code: r.code } });
      }
      if (action === "admin/reseller-report") {
        const report = await S.resellerReport(String(body.code || q.code || "").toUpperCase());
        return report ? sendJson(res, 200, { ok: true, report }) : sendJson(res, 404, { ok: false, error: "Reseller not found" });
      }
      if (action === "admin/reseller-update") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const code = String(body.code || "").toUpperCase();
        const supplied = body.patch || body;
        const patch = {};
        if (supplied.username !== undefined || (supplied.newPassword !== undefined && supplied.newPassword !== "")) {
          const reset = await S.setResellerCredentials(code, { username: supplied.username, password: supplied.newPassword || undefined }, { resetKey: supplied.newPassword !== undefined && supplied.newPassword !== "" });
          return sendJson(res, 200, { ok: true, reseller: S.resellerPublic(reset), ...(reset.apiKey ? { apiKey: reset.apiKey } : {}), note: "Credentials updated; previous sessions invalidated." });
        }
        for (const field of ["name", "email", "whatsapp"]) if (supplied[field] !== undefined) patch[field] = String(supplied[field]).trim().slice(0, field === "email" ? 120 : field === "name" ? 80 : 30);
        if (supplied.status !== undefined) {
          if (!["active", "suspended"].includes(supplied.status)) return sendJson(res, 400, { ok: false, error: "Status must be active or suspended" });
          patch.status = supplied.status;
        }
        if (!Object.keys(patch).length) return sendJson(res, 400, { ok: false, error: "Nothing to update" });
        const r = await S.updateReseller(code, patch);
        if (!r) return sendJson(res, 404, { ok: false, error: "Not found" });
        await S.pushAudit("reseller.updated", { resellerCode: code, fields: Object.keys(patch), ...(patch.status ? { status: patch.status } : {}) });
        return sendJson(res, 200, { ok: true, reseller: S.resellerPublic(r) });
      }
      if (action === "admin/credits-topup") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const r = await S.topUpCredits(String(body.code || "").toUpperCase(), Number(body.credits || 0));
        return r ? sendJson(res, 200, { ok: true, credits: r.credits }) : sendJson(res, 404, { ok: false, error: "Reseller not found" });
      }
      if (action === "admin/orders") return sendJson(res, 200, { ok: true, orders: await S.listOrders() });
      if (action === "admin/order-review") {
        const o = await S.getOrder(String(body.id || "").toUpperCase());
        if (!o) return sendJson(res, 404, { ok: false, error: "Order not found" });
        if (o.status !== "pending") return sendJson(res, 409, { ok: false, error: `Order is already ${o.status}.`, order: o });
        if (body.approve === true || body.approve === "true") {
          const client = await S.createClient({
            name: o.name, email: o.email, whatsapp: o.whatsapp,
            planId: o.planId, days: o.days, resellerCode: o.resellerCode, source: "order", orderId: o.id
          });
          const updated = await S.updateOrder(o.id, { status: "approved", reviewedAt: new Date().toISOString(), clientUsername: client.username });
          return sendJson(res, 200, {
            ok: true, order: updated, client,
            links: {
              m3u: `${base}/get.php?username=${client.username}&password=${client.password}&type=m3u_plus&output=m3u8`,
              playerApi: `${base}/player_api.php?username=${client.username}&password=${client.password}`
            }
          });
        }
        const updated = await S.updateOrder(o.id, { status: "rejected", reviewedAt: new Date().toISOString() });
        return sendJson(res, 200, { ok: true, order: updated });
      }
      if (action === "admin/payments") return sendJson(res, 200, { ok: true, payments: await S.listPayments() });
      if (action === "admin/trials") return sendJson(res, 200, { ok: true, trials: await S.listTrials() });
      if (action === "admin/api-keys") return sendJson(res, 200, { ok: true, keys: await S.listApiKeys() });
      if (action === "admin/api-key-create") {
        const k = await S.createApiKey({ label: body.label, expiresDays: Number(body.expiresDays) || 0 });
        return sendJson(res, 201, { ok: true, apiKey: k.apiKey, id: k.id, label: k.label, expiresAt: k.expiresAt });
      }
      if (action === "admin/api-key-revoke") {
        const { hashApiKey } = await import("../_lib/auth.js");
        const target = String(body.hash || body.id || "");
        const ok = await S.revokeApiKeyByHash(target.startsWith("mzk_") ? hashApiKey(target) : target);
        return ok ? sendJson(res, 200, { ok: true, revoked: true }) : sendJson(res, 404, { ok: false, error: "Key not found" });
      }
      if (action === "admin/playout-preview") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const cards = ["offline", "recharge", "comingSoon"];
        if (body.card && !cards.includes(body.card)) return sendJson(res, 400, { ok: false, error: "Unknown broadcast card" });
        if (!body.card && !(await S.resolveMedia("live", body.id))) return sendJson(res, 404, { ok: false, error: "Channel not found" });
        const token = signPayload({ u: "owner-preview", k: "live", f: body.id || "preview-card", preview: true, card: body.card || "" }, serverSecret("MZ_STREAM_SECRET", "mizanora-iptv-stream-v3"), 900);
        return sendJson(res, 200, { ok: true, url: `${base}/s/${token}`, expiresIn: 900 });
      }
      if (action === "admin/settings") return sendJson(res, 200, { ok: true, settings: await S.getSettings() });
      if (action === "admin/settings-set") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        return sendJson(res, 200, { ok: true, settings: await S.setSettings(body.patch || body) });
      }
      if (action === "admin/analytics") return sendJson(res, 200, { ok: true, analytics: await S.getAnalytics() });
      if (action === "admin/audit") return sendJson(res, 200, { ok: true, audit: await S.listAudit(Number(q.limit) || 60) });
      if (action === "admin/errors") return sendJson(res, 200, { ok: true, errors: await S.listClientErrors(Number(q.limit) || 50) });
      if (action === "admin/secure-link") {
        const t = await S.getClient(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Not found" });
        const file = body.file || (await S.listChannels()).find((c) => c.status !== "inactive")?.id;
        if (!file) return sendJson(res, 404, { ok: false, error: "No channel available to sign." });
        return sendJson(res, 200, { ok: true, ...S.signStreamFor(base, t.username, file, body.kind || "live") });
      }
      return sendJson(res, 400, { ok: false, error: "Unknown admin action: " + action });
    }

    return sendJson(res, 400, { ok: false, error: "Unknown action: " + action });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error("panel error:", err);
    return sendJson(res, err.status || 500, { ok: false, error: "Panel request failed: " + (err?.message || err) });
  }
}

function helpDoc(base) {
  return {
    ok: true,
    version: "6.1.0",
    brand: "Mizanora IPTV",
    base,
    links: { site: `${base}/`, resellerPanel: `${base}/reseller`, developers: `${base}/developers` },
    convention: "GET → ?action=NAME · POST → JSON body {\"action\":\"NAME\", …}",
    auth: {
      public: "no key",
      reseller: "x-api-key: mzr_… (reseller/register ya reseller/login-password se)",
      admin: "Authorization: Bearer <firebaseIdToken> (owner Google) OR x-admin-token: mzp_… (admin/pin-login) OR x-api-key: mzk_…"
    },
    actions: {
      public: ["config", "plans", "help", "order", "order-status", "trial", "resolve {username,password}", "track {sessionId,event,route}", "reseller/register", "reseller/login-password", "recharge/contact"],
      reseller: ["reseller/login {username|code,password} → 12h session", "reseller/profile-update {currentPassword,username?,newPassword?,confirmPassword?,name?,whatsapp?,branding?}", "reseller/me|stats", "reseller/clients", "reseller/client-create {name,planId?,mac?,collectAmount?,via?} — plan months = credit cost", "reseller/credentials {username}", "reseller/client-update {username,…}", "reseller/client-renew {username,planId?} — plan months = credit cost", "reseller/client-suspend|client-block {username}", "reseller/client-delete {username}", "reseller/secure-link {username,file?,kind?}", "reseller/key-rotate", "reseller/pricing-set {pricing}", "reseller/payment-record {username,amount,months,via} — one credit per extension month", "reseller/finance", "reseller/ledger", "reseller/report", "reseller/activity"],
      admin: ["admin/me", "admin/pin-login {pin}", "admin/xtream-accounts", "admin/xtream/create|update|renew|suspend|activate|delete {username,…}", "admin/stalker/list", "admin/channels", "admin/channel-create|channel-update|channel-delete", "admin/channel-move {id,position}", "admin/channel-sort {mode}", "admin/channel-reorder {ids}", "admin/channels/import {url|content,name?,defaultTier?,importEpg?}", "admin/epg-sources|epg-import|epg-refresh|epg-delete", "admin/playlists", "admin/playlist-save|playlist-delete", "admin/movie-update|series-update", "admin/catalog-sort {kind,mode}", "admin/epg-map {id,epgId}", "admin/epg-auto-map", "admin/clients", "admin/client-create|renew|suspend|delete", "admin/resellers", "admin/reseller-report {code}", "admin/reseller-create|reseller-update", "admin/credits-topup {code,credits}", "admin/orders", "admin/order-review {id,approve}", "admin/payments", "admin/trials", "admin/api-keys", "admin/api-key-create {label,expiresDays?}", "admin/api-key-revoke {id|hash}", "admin/settings|settings-set", "admin/playout-preview {id|card} — private 15-minute HLS preview", "admin/analytics", "admin/audit", "admin/errors", "admin/secure-link {username}"]
    },
    protocols: {
      xtreamPlayerApi: `${base}/player_api.php?username=U&password=P`,
      m3uPlus: `${base}/get.php?username=U&password=P&type=m3u_plus&output=m3u8`,
      epg: `${base}/xmltv.php?username=U&password=P`,
      live: `${base}/live/U/P/<id>.m3u8`, movie: `${base}/movie/U/P/<id>.mp4`, series: `${base}/series/U/P/<id>/<ep>.mp4`,
      magPortal: `${base}/portal.php`, signedLink: `${base}/s/<token>`
    },
    embedApi: `${base}/api/embed?action=config|channels|guide|movies|series|order|trial|order-status|health  (+ widget ${base}/embed.js — CORS *)`
  };
}
