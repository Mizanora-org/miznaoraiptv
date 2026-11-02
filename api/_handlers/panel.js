/**
 * Mizanora IPTV — Panel API handler (fresh rebuild)
 *   /api/panel?action=… (GET)   /api/panel  POST {"action":…}
 * Sections: public • reseller (mzr_) • admin (owner Google token / mzp_ PIN / mzk_ key)
 */
import { handleOptions, parseBody, parseQuery, sendJson, getRequestBaseUrl, checkRateLimit, normalizeMac, isValidEmail, WA_LINK, WA_NUMBER, OWNER_EMAIL } from "../_lib/util.js";
import { authenticateAdmin, authorizeReseller, createPinSession, verifyBootstrapPin } from "../_lib/auth.js";
import * as S from "../_lib/store.js";

const PUBLIC_ACTIONS = new Set([
  "config", "plans", "help", "order", "order-status", "trial", "resolve",
  "reseller/register", "reseller/login-password", "recharge/contact"
]);
const RESELLER_ACTIONS = new Set([
  "reseller/login", "reseller/me", "reseller/stats", "reseller/clients",
  "reseller/client-create", "reseller/credentials", "reseller/client-update",
  "reseller/client-renew", "reseller/client-suspend", "reseller/client-block",
  "reseller/client-delete", "reseller/secure-link", "reseller/key-rotate",
  "reseller/pricing-set", "reseller/payment-record", "reseller/finance", "reseller/ledger"
]);
const ADMIN_ACTIONS = new Set([
  "admin/me", "admin/pin-login", "admin/pin-set",
  "admin/xtream-accounts", "admin/xtream/create", "admin/xtream/update", "admin/xtream/renew",
  "admin/xtream/suspend", "admin/xtream/activate", "admin/xtream/delete",
  "admin/stalker/list", "admin/channels", "admin/clients",
  "admin/client-create", "admin/client-renew", "admin/client-suspend", "admin/client-delete",
  "admin/resellers", "admin/reseller-create", "admin/reseller-update", "admin/credits-topup",
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
  const body = isPost ? await parseBody(req) : {};
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
      if (action === "order") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
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
        return sendJson(res, 200, { ok: true, order: o });
      }
      if (action === "trial") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
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
        // resolve a username -> public-safe info + links (used by landing page)
        const u = String(body.username || q.username || "").toLowerCase();
        const c = await S.getClient(u);
        if (!c) return sendJson(res, 404, { ok: false, error: "Account not found" });
        return sendJson(res, 200, {
          ok: true,
          username: c.username,
          status: c.status, expired: c.expired, daysLeft: c.daysLeft,
          mac: c.mac || undefined,
          links: {
            m3u: `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=m3u8`,
            epg: `${base}/xmltv.php?username=${c.username}&password=${c.password}`,
            playerApi: `${base}/player_api.php?username=${c.username}&password=${c.password}`,
            magPortal: c.mac ? `${base}/c/portal.php` : undefined
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
        if (String(body.password || "").length < 6) return sendJson(res, 400, { ok: false, error: "Password min 6 characters" });
        const existing = (await S.listResellers()).find((r) => r.email === email);
        if (existing) return sendJson(res, 409, { ok: false, error: "Is email se pehle se reseller account hai — login karein.", code: existing.code });
        const created = await S.createReseller({ ...body, email, credits: S.SELF_SERVE.signupCredits });
        return sendJson(res, 201, {
          ok: true,
          message: `Welcome ${created.name || "Dealer"}! Aapka reseller panel ready hai — ${created.credits} free starter credits mile.`,
          reseller: { ...S.resellerPublic(created), apiKey: created.apiKey, code: created.code }
        });
      }
      if (action === "reseller/login-password") {
        if (!isPost) return sendJson(res, 405, { ok: false, error: "POST required" });
        const r = await authorizeReseller(req, body);
        if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
        await S.updateReseller(r.reseller.code, { lastLoginAt: new Date().toISOString() });
        return sendJson(res, 200, { ok: true, reseller: S.resellerPublic(r.reseller) });
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
        magPortal: c.mac ? `${base}/c/portal.php` : undefined,
        xtream: { host: base, port: 443, username: c.username, password: c.password }
      });

      if (action === "reseller/login" || action === "reseller/me" || action === "reseller/stats") {
        await S.updateReseller(R.code, { lastLoginAt: new Date().toISOString() });
        const clients = await S.listClients({ resellerCode: R.code });
        const stats = S.resellerStats(clients);
        const pricing = R.pricing || {};
        return sendJson(res, 200, {
          ok: true,
          reseller: S.resellerPublic(R),
          stats: { ...stats, retailValue: stats.active * (Number(pricing.monthly) || S.PANEL.directPerUserMonthly) },
          finance: await S.resellerFinance(R.code),
          selfServe: { enabled: S.SELF_SERVE.enabled, signupCredits: S.SELF_SERVE.signupCredits, unitCost: S.SELF_SERVE.unitCost, pricePresets: S.SELF_SERVE.pricePresets, allowMacClients: S.SELF_SERVE.allowMacClients },
          clients: clients.map((c) => ({ ...c, password: undefined })),
          xtream: { serverUrl: base, m3uPlus: `${base}/get.php?username=USER&password=PASS&type=m3u_plus&output=m3u8`, epg: `${base}/xmltv.php?username=USER&password=PASS` }
        });
      }
      if (action === "reseller/clients") {
        const clients = await S.listClients({ resellerCode: R.code });
        return sendJson(res, 200, { ok: true, count: clients.length, clients });
      }
      if (action === "reseller/client-create") {
        if (Number(R.credits || 0) < 1) {
          return sendJson(res, 402, { ok: false, error: `Credits khatam. JazzCash ${WA_NUMBER} par bhejein aur WhatsApp par screenshot karein.` });
        }
        let mac = "";
        if (body.mac) {
          if (!S.SELF_SERVE.allowMacClients) return sendJson(res, 403, { ok: false, error: "MAC/Stalker clients disabled." });
          mac = normalizeMac(body.mac);
          if (!mac) return sendJson(res, 400, { ok: false, error: "Invalid MAC (format 00:1A:79:XX:XX:XX)" });
          const all = await S.listClients();
          if (all.some((c) => c.mac && c.mac.toUpperCase() === mac)) return sendJson(res, 409, { ok: false, error: "Ye MAC pehle se registered hai." });
        }
        const created = await S.createClient({ ...body, mac, resellerCode: R.code, source: mac ? "reseller-mac" : "reseller" });
        await S.updateReseller(R.code, { credits: Number(R.credits) - 1, creditsUsed: Number(R.creditsUsed || 0) + 1 });
        const pricing = R.pricing || {};
        const collectAmount = Math.max(0, Number(body.collectAmount) || 0);
        const connectionFee = Math.max(0, Number(body.connectionFee ?? pricing.connectionFee ?? 0) || 0);
        let feeRecord = null;
        const amt = collectAmount > 0 ? collectAmount : connectionFee;
        if (amt > 0 && body.collectFee !== false) {
          const rec = await S.recordClientPayment({
            username: created.username, amount: amt,
            months: collectAmount > 0 ? Math.round((Number(body.days) || 30) / 30) : 0,
            via: body.via || "cash", note: collectAmount > 0 ? "Client sale (connection + plan)" : "Connection fee",
            resellerCode: R.code, recordedBy: "reseller"
          });
          feeRecord = rec.payment;
        }
        S.clearPanelCache();
        return sendJson(res, 200, {
          ok: true, client: created, creditsLeft: Number(R.credits) - 1, connectionFee: feeRecord,
          finance: await S.resellerFinance(R.code),
          stalker: mac ? { portalUrl: `${base}/c/portal.php`, mac, note: "MAG/Stalker box mein ye Portal URL + MAC daalein." } : undefined,
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
          credentials: { serverUrl: base, port: 443, username: t.username, password: t.password, mac: t.mac || undefined, ...clientLinks(base, t), signedLink: S.signStreamFor(base, t.username, "index.m3u8", "live").url }
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
        if (!Object.keys(patch).length) return sendJson(res, 400, { ok: false, error: "Nothing to update." });
        const updated = await S.updateClient(t.username, patch);
        S.clearPanelCache();
        return sendJson(res, 200, { ok: true, client: updated });
      }
      if (action === "reseller/client-renew") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        if (Number(R.credits || 0) < 1) return sendJson(res, 402, { ok: false, error: "No credits left to renew." });
        const renewed = await S.renewClient(t.username, { planId: body.planId || "monthly" });
        await S.updateReseller(R.code, { credits: Number(R.credits) - 1, creditsUsed: Number(R.creditsUsed || 0) + 1 });
        return sendJson(res, 200, { ok: true, client: renewed, creditsLeft: Number(R.credits) - 1 });
      }
      if (action === "reseller/client-suspend" || action === "reseller/client-block") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const updated = await S.suspendClient(t.username, body.suspended !== false && body.blocked !== false);
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
        return sendJson(res, 200, { ok: true, ...S.signStreamFor(base, t.username, body.file || "index.m3u8", body.kind || "live") });
      }
      if (action === "reseller/key-rotate") {
        const { generateResellerApiKey } = await import("../_lib/auth.js");
        const { hashApiKey } = await import("../_lib/auth.js");
        const newKey = generateResellerApiKey();
        await S.updateReseller(R.code, { apiKeyHash: hashApiKey(newKey) });
        S.clearPanelCache();
        return sendJson(res, 200, { ok: true, apiKey: newKey, note: "Purana mzr_ key foran invalid. Naya key ek dafa dikhta hai — save kar lo." });
      }
      if (action === "reseller/pricing-set") {
        const p = R.pricing || {};
        await S.updateReseller(R.code, { pricing: { ...p, ...body.pricing } });
        return sendJson(res, 200, { ok: true, pricing: (await S.getResellerByCode(R.code)).pricing });
      }
      if (action === "reseller/payment-record") {
        const t = await owned(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Client not found in your panel." });
        const rec = await S.recordClientPayment({ ...body, username: t.username, resellerCode: R.code, recordedBy: "reseller" });
        return sendJson(res, 200, rec);
      }
      if (action === "reseller/finance") return sendJson(res, 200, { ok: true, finance: await S.resellerFinance(R.code) });
      if (action === "reseller/ledger") return sendJson(res, 200, { ok: true, payments: await S.listPayments({ resellerCode: R.code }) });
      return sendJson(res, 400, { ok: false, error: "Unknown reseller action: " + action });
    }

    /* ================= ADMIN ================= */
    if (ADMIN_ACTIONS.has(action) || action.startsWith("admin/")) {
      // bootstrap: PIN login works without any prior auth
      if (action === "admin/pin-login") {
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
      if (action === "admin/pin-set") return sendJson(res, 200, { ok: true, note: "Bootstrap PIN fixed hai (repo config)." });
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
        return sendJson(res, 200, { ok: true, client: await S.updateClient(t.username, body) });
      }
      if (action === "admin/xtream/renew") {
        const t = await S.getClient(body.username);
        if (!t) return sendJson(res, 404, { ok: false, error: "Not found" });
        return sendJson(res, 200, { ok: true, client: await S.renewClient(t.username, { planId: body.planId || "monthly" }) });
      }
      if (action === "admin/xtream/suspend") return sendJson(res, 200, { ok: true, client: await S.suspendClient(body.username, true) });
      if (action === "admin/xtream/activate") return sendJson(res, 200, { ok: true, client: await S.suspendClient(body.username, false) });
      if (action === "admin/xtream/delete") { await S.deleteClient(body.username); return sendJson(res, 200, { ok: true, deleted: body.username }); }
      if (action === "admin/stalker/list") return sendJson(res, 200, { ok: true, clients: await S.listStalkerClients() });
      if (action === "admin/channels") return sendJson(res, 200, { ok: true, count: (await S.listChannels()).length, channels: await S.listChannels() });
      if (action === "admin/clients") return sendJson(res, 200, { ok: true, count: (await S.listClients()).length, clients: await S.listClients() });
      if (action === "admin/client-create") return sendJson(res, 200, { ok: true, client: await S.createClient({ ...body, source: "admin" }) });
      if (action === "admin/client-renew") return sendJson(res, 200, { ok: true, client: await S.renewClient(body.username, { planId: body.planId || "monthly" }) });
      if (action === "admin/client-suspend") return sendJson(res, 200, { ok: true, client: await S.suspendClient(body.username, body.suspended !== false) });
      if (action === "admin/client-delete") { await S.deleteClient(body.username); return sendJson(res, 200, { ok: true }); }
      if (action === "admin/resellers") return sendJson(res, 200, { ok: true, resellers: await S.listResellers() });
      if (action === "admin/reseller-create") {
        const r = await S.createReseller(body);
        return sendJson(res, 201, { ok: true, reseller: { ...S.resellerPublic(r), apiKey: r.apiKey, code: r.code } });
      }
      if (action === "admin/reseller-update") {
        const r = await S.updateReseller(String(body.code || "").toUpperCase(), body.patch || body);
        return r ? sendJson(res, 200, { ok: true, reseller: S.resellerPublic(r) }) : sendJson(res, 404, { ok: false, error: "Not found" });
      }
      if (action === "admin/credits-topup") {
        const r = await S.topUpCredits(String(body.code || "").toUpperCase(), Number(body.credits || 0));
        return r ? sendJson(res, 200, { ok: true, credits: r.credits }) : sendJson(res, 404, { ok: false, error: "Reseller not found" });
      }
      if (action === "admin/orders") return sendJson(res, 200, { ok: true, orders: await S.listOrders() });
      if (action === "admin/order-review") {
        const o = await S.getOrder(String(body.id || "").toUpperCase());
        if (!o) return sendJson(res, 404, { ok: false, error: "Order not found" });
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
        const target = String(body.hash || "");
        const ok = await S.revokeApiKeyByHash(target.startsWith("mzk_") ? hashApiKey(target) : target);
        return ok ? sendJson(res, 200, { ok: true, revoked: true }) : sendJson(res, 404, { ok: false, error: "Key not found" });
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
        return sendJson(res, 200, { ok: true, ...S.signStreamFor(base, t.username, body.file || "index.m3u8", body.kind || "live") });
      }
      return sendJson(res, 400, { ok: false, error: "Unknown admin action: " + action });
    }

    return sendJson(res, 400, { ok: false, error: "Unknown action: " + action });
  } catch (err) {
    console.error("panel error:", err);
    return sendJson(res, 500, { ok: false, error: "Panel request failed: " + (err?.message || err) });
  }
}

function helpDoc(base) {
  return {
    ok: true,
    brand: "Mizanora IPTV",
    base,
    convention: "GET → ?action=NAME · POST → JSON body {\"action\":\"NAME\", …}",
    auth: {
      public: "no key",
      reseller: "x-api-key: mzr_… (reseller/register ya reseller/login-password se)",
      admin: "Authorization: Bearer <firebaseIdToken> (owner Google) OR x-admin-token: mzp_… (admin/pin-login) OR x-api-key: mzk_…"
    },
    actions: {
      public: ["config", "plans", "help", "order", "order-status", "trial", "resolve", "reseller/register", "reseller/login-password", "recharge/contact"],
      reseller: ["reseller/login {code,password}", "reseller/me|stats", "reseller/clients", "reseller/client-create {name,days,planId?,mac?,collectAmount?,via?}", "reseller/credentials {username}", "reseller/client-update {username,…}", "reseller/client-renew {username,planId?}", "reseller/client-suspend|client-block {username}", "reseller/client-delete {username}", "reseller/secure-link {username,file?,kind?}", "reseller/key-rotate", "reseller/pricing-set {pricing}", "reseller/payment-record {username,amount,months,via}", "reseller/finance", "reseller/ledger"],
      admin: ["admin/me", "admin/pin-login {pin}", "admin/xtream-accounts", "admin/xtream/create|update|renew|suspend|activate|delete {username,…}", "admin/stalker/list", "admin/channels", "admin/clients", "admin/client-create|renew|suspend|delete", "admin/resellers", "admin/reseller-create|reseller-update", "admin/credits-topup {code,credits}", "admin/orders", "admin/order-review {id,approve}", "admin/payments", "admin/trials", "admin/api-keys", "admin/api-key-create {label,expiresDays?}", "admin/api-key-revoke {hash}", "admin/settings|settings-set", "admin/analytics", "admin/audit", "admin/errors", "admin/secure-link {username}"]
    },
    protocols: {
      xtreamPlayerApi: `${base}/player_api.php?username=U&password=P`,
      m3uPlus: `${base}/get.php?username=U&password=P&type=m3u_plus&output=m3u8`,
      epg: `${base}/xmltv.php?username=U&password=P`,
      live: `${base}/live/U/P/<id>.m3u8`, movie: `${base}/movie/U/P/<id>.mp4`, series: `${base}/series/U/P/<id>/<ep>.mp4`,
      magPortal: `${base}/portal.php`, signedLink: `${base}/s/<token>`
    },
    embedApi: `${base}/api/embed?action=config|channels|movies|series|order|trial|order-status|health  (+ widget ${base}/embed.js — CORS *)`
  };
}
