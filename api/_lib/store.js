/**
 * Mizanora IPTV — domain store: clients, Xtream mirror, resellers, orders,
 * payments, trials, API keys, audit, settings, analytics. Fresh rebuild.
 * Data model (Firebase RTDB, project mizanoranet):
 *   panel/clients/<username>          panel/xtreamAccounts/<username> (mirror)
 *   panel/resellers/<code>            panel/orders/<id>      panel/payments/<id>
 *   panel/trials/<id>                 panel/apiKeys/<id>     panel/audit/<id>
 *   panel/settings                    panel/analytics/…      panel/clientErrors/<id>
 *   channels, movies, series, playlists, stalkerSessions/<mac>
 */
import { rtdbGet, rtdbSet } from "./rtdb.js";
import { sha256, randomHex, randomPassword, signPayload, normalizeMac, isValidEmail, WA_LINK, WA_NUMBER, OWNER_EMAIL } from "./util.js";
import { hashApiKey, generateAdminApiKey, generateResellerApiKey } from "./auth.js";
import { BRAND, DEFAULT_SETTINGS, DEFAULT_CHANNELS } from "../../data/catalog.js";
import { PANEL, SELF_SERVE, PLANS, getPlan } from "../../data/panel.js";

export { BRAND, PANEL, SELF_SERVE, PLANS, getPlan, DEFAULT_SETTINGS, DEFAULT_CHANNELS };

const nowIso = () => new Date().toISOString();
const ROOT = "panel";
const CACHE = new Map();

async function readNode(path, ttl = 5000) {
  const full = `${ROOT}/${path}`;
  const hit = CACHE.get(full);
  if (hit && Date.now() - hit.ts < ttl) return hit.value;
  const v = await rtdbGet(full);
  CACHE.set(full, { ts: Date.now(), value: v });
  return v;
}
async function writeNode(path, value) {
  const full = `${ROOT}/${path}`;
  for (const key of [...CACHE.keys()]) {
    if (key === full || full.startsWith(key + "/") || key.startsWith(full + "/")) CACHE.delete(key);
  }
  return rtdbSet(full, value);
}
export function clearPanelCache() { CACHE.clear(); }

export async function pushAudit(action, detail = {}) {
  const id = randomHex(6);
  await rtdbSet(`${ROOT}/audit/${id}`, { id, action, detail, at: nowIso(), ip: detail.ip || "" });
  return id;
}

/* ---------------- clients + xtream mirror ---------------- */
export function normalizeClient(c) {
  if (!c) return null;
  const exp = Number(c.expDate || 0);
  const now = Math.floor(Date.now() / 1000);
  return {
    ...c,
    daysLeft: Math.max(0, Math.ceil((exp - now) / 86400)),
    expired: exp > 0 && exp < now
  };
}
export async function listClients(filter = {}) {
  const all = (await readNode("clients")) || {};
  let list = Object.values(all).map(normalizeClient).filter(Boolean);
  if (filter.resellerCode) list = list.filter((c) => c.resellerCode === filter.resellerCode);
  if (filter.status) list = list.filter((c) => c.status === filter.status);
  return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export async function getClient(username) {
  const c = await readNode(`clients/${String(username || "").toLowerCase()}`);
  return normalizeClient(c);
}
export async function createClient(input = {}) {
  const plan = getPlan(input.planId) || PLANS.find((p) => p.id === "monthly") || PLANS[1];
  const username = (String(input.username || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "mz" + randomHex(3)).slice(0, 24);
  const password = String(input.password || "").trim() || randomPassword(10);
  const days = Number(input.days) || plan.days || 30;
  const startTs = Number(input.startTs) || Math.floor(Date.now() / 1000);
  const client = {
    username, password,
    email: String(input.email || "").trim().toLowerCase().slice(0, 120),
    whatsapp: String(input.whatsapp || "").trim().slice(0, 30),
    name: String(input.name || input.displayName || "").slice(0, 80),
    resellerCode: String(input.resellerCode || "").trim().toUpperCase(),
    planId: plan.id, plan: "pro", tier: "pro",
    status: "active",
    devices: Math.max(1, Number(input.devices) || plan.devices || 1),
    mac: normalizeMac(input.mac || "") || "",
    startDate: startTs, expDate: startTs + days * 86400,
    createdAt: nowIso(), source: String(input.source || "panel").slice(0, 40),
    orderId: String(input.orderId || ""), note: String(input.note || "").slice(0, 300)
  };
  await writeNode(`clients/${username}`, client);
  await mirrorXtream(client);
  await pushAudit("client.created", { username, planId: plan.id, resellerCode: client.resellerCode });
  return client;
}
export async function mirrorXtream(c) {
  await rtdbSet(`xtreamAccounts/${c.username}`, {
    username: c.username, password: c.password,
    uid: c.resellerCode || "panel", displayName: c.name || c.username,
    plan: "pro", planId: c.planId || "monthly", status: c.status === "suspended" ? "Suspended" : "Active",
    tier: "pro", maxConnections: Number(c.devices) || 1,
    resellerCode: c.resellerCode || "", mac: c.mac || "",
    expDate: Number(c.expDate) || 0, createdAt: c.createdAt || nowIso()
  });
}
export async function updateClient(username, patch = {}) {
  const client = await getClient(username);
  if (!client) return null;
  const updated = { ...client, ...patch, username: client.username };
  delete updated.daysLeft; delete updated.expired;
  await writeNode(`clients/${username}`, updated);
  await mirrorXtream(updated);
  return updated;
}
export async function renewClient(username, { planId = "monthly" } = {}) {
  const plan = getPlan(planId) || PLANS.find((p) => p.id === "monthly");
  const client = await getClient(username);
  if (!client) return null;
  const base = Math.max(Number(client.expDate || 0), Math.floor(Date.now() / 1000));
  const updated = await updateClient(username, {
    expDate: base + (Number(plan.days) || 30) * 86400,
    planId: plan.id, plan: "pro", status: "active"
  });
  await pushAudit("client.renewed", { username, planId: plan.id });
  return updated;
}
export async function suspendClient(username, suspended = true) {
  return updateClient(username, { status: suspended ? "suspended" : "active" });
}
export async function deleteClient(username) {
  await writeNode(`clients/${username}`, null);
  await rtdbSet(`xtreamAccounts/${username}`, null);
  await pushAudit("client.deleted", { username });
  clearPanelCache();
  return true;
}

/* ---------------- resellers ---------------- */
export function resellerPublic(r) {
  if (!r) return null;
  const { passwordHash, apiKeyHash, ...pub } = r;
  return pub;
}
export async function listResellers() {
  const all = (await readNode("resellers")) || {};
  return Object.entries(all).map(([code, r]) => ({ code, ...resellerPublic(r) }));
}
export async function getResellerByCode(code) {
  const all = (await readNode("resellers")) || {};
  const r = all[String(code || "").toUpperCase()];
  return r ? { code: String(code).toUpperCase(), ...r } : null;
}
export async function getResellerByApiKey(key) {
  if (!String(key || "").startsWith("mzr_")) return null;
  const hash = hashApiKey(key);
  const all = (await readNode("resellers")) || {};
  for (const [code, r] of Object.entries(all)) {
    if (r.apiKeyHash === hash && r.status !== "suspended") return { code, ...r };
  }
  return null;
}
export async function createReseller(input = {}) {
  const code = (String(input.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "RS-" + randomHex(3).toUpperCase());
  const apiKey = generateResellerApiKey();
  const rec = {
    code, name: String(input.name || "").slice(0, 80),
    email: String(input.email || "").toLowerCase().slice(0, 120),
    whatsapp: String(input.whatsapp || "").slice(0, 30),
    passwordHash: sha256(String(input.password || randomPassword(10))),
    apiKeyHash: hashApiKey(apiKey),
    credits: Number(input.credits ?? SELF_SERVE.signupCredits) || 0,
    creditsUsed: 0,
    pricing: { monthly: SELF_SERVE.monthlyDefault, connectionFee: SELF_SERVE.connectionFeeDefault },
    status: "active", createdAt: nowIso(), lastLoginAt: ""
  };
  await writeNode(`resellers/${code}`, rec);
  await pushAudit("reseller.created", { code });
  return { ...rec, apiKey };
}
export async function updateReseller(code, patch = {}) {
  const r = await getResellerByCode(code);
  if (!r) return null;
  const next = { ...r, ...patch, code };
  delete next.daysLeft;
  await writeNode(`resellers/${code}`, next);
  return next;
}
export async function topUpCredits(code, amount) {
  const r = await getResellerByCode(code);
  if (!r) return null;
  return updateReseller(code, { credits: Math.max(0, Number(r.credits || 0) + Number(amount || 0)) });
}
export function resellerStats(clients) {
  const active = clients.filter((c) => c.status === "active" && !c.expired).length;
  const suspended = clients.filter((c) => c.status === "suspended").length;
  const expired = clients.filter((c) => c.expired && c.status !== "suspended").length;
  return { total: clients.length, active, suspended, expired };
}
export async function resellerFinance(code) {
  const payments = await listPayments({ resellerCode: code });
  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const reseller = await getResellerByCode(code);
  return {
    credits: Number(reseller?.credits || 0),
    creditsUsed: Number(reseller?.creditsUsed || 0),
    collectedTotal: total,
    paymentsCount: payments.length,
    dealerCostPerUser: SELF_SERVE.unitCost
  };
}

/* ---------------- orders / payments / trials ---------------- */
export async function createOrder(input = {}) {
  const id = "ORD-" + randomHex(4).toUpperCase();
  const plan = getPlan(input.planId) || PLANS.find((p) => p.id === "monthly");
  const order = {
    id,
    name: String(input.name || "").slice(0, 80),
    email: String(input.email || "").toLowerCase().slice(0, 120),
    whatsapp: String(input.whatsapp || "").slice(0, 30),
    planId: plan.id, days: Number(input.days) || plan.days || 30,
    audience: input.audience === "reseller" ? "reseller" : "direct",
    amount: Number(input.amount) || 0,
    via: String(input.via || "whatsapp").slice(0, 30),
    status: "pending", proof: String(input.proof || "").slice(0, 500),
    resellerCode: String(input.resellerCode || "").toUpperCase(),
    createdAt: nowIso(), reviewedAt: "", clientUsername: ""
  };
  await writeNode(`orders/${id}`, order);
  return order;
}
export async function listOrders() {
  const all = (await readNode("orders")) || {};
  return Object.values(all).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export async function getOrder(id) { return readNode(`orders/${id}`); }
export async function updateOrder(id, patch) {
  const o = await getOrder(id);
  if (!o) return null;
  const next = { ...o, ...patch, id };
  await writeNode(`orders/${id}`, next);
  return next;
}
export async function recordClientPayment(input = {}) {
  const id = "PAY-" + randomHex(4).toUpperCase();
  const payment = {
    id,
    username: String(input.username || "").toLowerCase(),
    amount: Number(input.amount || 0),
    months: Number(input.months || 0),
    via: String(input.via || "cash").slice(0, 30),
    note: String(input.note || "").slice(0, 300),
    resellerCode: String(input.resellerCode || "").toUpperCase(),
    recordedBy: String(input.recordedBy || "admin").slice(0, 30),
    at: nowIso()
  };
  await writeNode(`payments/${id}`, payment);
  // extend client expiry if months given
  if (payment.months > 0 && payment.username) {
    const c = await getClient(payment.username);
    if (c) {
      const base = Math.max(Number(c.expDate || 0), Math.floor(Date.now() / 1000));
      await updateClient(payment.username, { expDate: base + payment.months * 30 * 86400, status: "active" });
    }
  }
  return { ok: true, payment };
}
export async function listPayments(filter = {}) {
  const all = (await readNode("payments")) || {};
  let list = Object.values(all);
  if (filter.resellerCode) list = list.filter((p) => p.resellerCode === filter.resellerCode);
  if (filter.username) list = list.filter((p) => p.username === filter.username);
  return list.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
export async function claimTrial({ email = "", deviceId = "", whatsapp = "" } = {}) {
  email = String(email || "").toLowerCase().trim();
  deviceId = String(deviceId || "").trim();
  if (!isValidEmail(email) && !deviceId) return { ok: false, error: "Email ya device id required" };
  const all = (await readNode("trials")) || {};
  const key = email || deviceId;
  const existing = Object.values(all).find((t) => t.email === email || (deviceId && t.deviceId === deviceId));
  if (existing) return { ok: false, error: "Trial pehle se claim kar chuke ho", trial: existing };
  const plan = PLANS.find((p) => p.id === "trial-1d") || PLANS[0];
  const client = await createClient({
    email, whatsapp, planId: plan.id, source: "trial",
    note: "1-day free trial"
  });
  const trial = { id: "TRL-" + randomHex(4).toUpperCase(), email, deviceId, whatsapp, username: client.username, planId: plan.id, at: nowIso() };
  await writeNode(`trials/${trial.id}`, trial);
  await pushAudit("trial.claimed", { email, username: client.username });
  return { ok: true, trial, client: { username: client.username, password: client.password, expDate: client.expDate } };
}
export async function listTrials() {
  const all = (await readNode("trials")) || {};
  return Object.values(all).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/* ---------------- settings / analytics / errors ---------------- */
export async function getSettings() {
  const s = (await rtdbGet("settings/defaults")) || {};
  return { ...DEFAULT_SETTINGS, ...s };
}
export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, updatedAt: nowIso() };
  await rtdbSet("settings/defaults", next);
  return next;
}
export async function recordClientError(req, body = {}) {
  const id = "ERR-" + randomHex(4).toUpperCase();
  const rec = {
    id, message: String(body.message || "").slice(0, 300),
    route: String(body.route || "").slice(0, 200), app: String(body.app || "site").slice(0, 20),
    stack: String(body.stack || "").slice(0, 800),
    ip: (req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim(),
    at: nowIso()
  };
  await rtdbSet(`${ROOT}/clientErrors/${id}`, rec);
  return rec;
}
export async function listClientErrors(limit = 50) {
  const all = (await readNode("clientErrors")) || {};
  return Object.values(all).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, limit);
}
export async function getAnalytics() {
  const a = (await rtdbGet("panel/analytics")) || {};
  const clients = await listClients();
  const orders = await listOrders();
  return {
    onlineNow: Number(a.onlineNow || 0),
    totalSessions: Number(a.totalSessions || 0),
    totalPlays: Number(a.totalPlays || 0),
    avgSessionSec: Number(a.avgSessionSec || 0),
    clients: resellerStats(clients),
    orders: { total: orders.length, pending: orders.filter((o) => o.status === "pending").length, approved: orders.filter((o) => o.status === "approved").length },
    resellers: (await listResellers()).length,
    updatedAt: nowIso()
  };
}
export async function listAudit(limit = 60) {
  const all = (await readNode("audit")) || {};
  return Object.values(all).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, limit);
}

/* ---------------- api keys ---------------- */
export async function listApiKeys() {
  const all = (await readNode("apiKeys")) || {};
  return Object.values(all).map((k) => ({ ...k, hash: undefined })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export async function createApiKey({ label = "", expiresDays = 0 } = {}) {
  const key = generateAdminApiKey();
  const id = randomHex(6);
  const rec = {
    id, label: String(label || "key").slice(0, 60), hash: hashApiKey(key),
    createdAt: nowIso(), lastUsedAt: "",
    expiresAt: expiresDays > 0 ? Date.now() + Number(expiresDays) * 86400000 : 0,
    revoked: false
  };
  await writeNode(`apiKeys/${id}`, rec);
  await pushAudit("apikey.created", { id, label: rec.label });
  return { ...rec, apiKey: key };
}
export async function revokeApiKeyByHash(hash) {
  const all = (await readNode("apiKeys")) || {};
  for (const [id, k] of Object.entries(all)) {
    if (k.hash === hash) {
      await writeNode(`apiKeys/${id}`, { ...k, revoked: true, revokedAt: nowIso() });
      clearPanelCache();
      await pushAudit("apikey.revoked", { id });
      return true;
    }
  }
  return false;
}

/* ---------------- channels ---------------- */
export async function listChannels() {
  const ch = (await rtdbGet("channels")) || {};
  const arr = Array.isArray(ch) ? ch : Object.values(ch || {});
  if (!arr.length) return DEFAULT_CHANNELS;
  return arr;
}

/* ---------------- signed stream links ---------------- */
const STREAM_SECRET = process.env.MZ_STREAM_SECRET || "mizanora-iptv-stream-v3";
export function signStreamFor(base, username, file = "index.m3u8", kind = "live") {
  const token = signPayload({ u: username, f: file, k: kind }, STREAM_SECRET, 900);
  return { url: `${base}/s/${token}`, token, expiresIn: 900 };
}

/* ---------------- stalker / MAG ---------------- */
export async function stalkerHandshake(mac) {
  mac = normalizeMac(mac);
  if (!mac) return null;
  const sessions = (await rtdbGet("stalkerSessions")) || {};
  const existing = sessions[mac];
  const now = Math.floor(Date.now() / 1000);
  if (existing && existing.exp > now) return existing;
  const token = randomHex(16);
  const session = { mac, token, exp: now + 8 * 3600, createdAt: nowIso() };
  await rtdbSet(`stalkerSessions/${mac.replace(/:/g, "")}`, session);
  return session;
}
export async function stalkerProfile(mac, token) {
  mac = normalizeMac(mac);
  const sessions = (await rtdbGet("stalkerSessions")) || {};
  const s = sessions[mac.replace(/:/g, "")];
  if (!s || s.token !== token || s.exp < Math.floor(Date.now() / 1000)) return null;
  const clients = (await readNode("clients")) || {};
  const client = Object.values(clients).find((c) => c.mac === mac);
  return { mac, status: client ? (client.status === "suspended" || (client.expDate && client.expDate < Date.now() / 1000) ? "blocked" : "active") : "active", username: client?.username || "" };
}
export async function listStalkerClients() {
  const clients = await listClients();
  return clients.filter((c) => c.mac).map((c) => ({ username: c.username, mac: c.mac, status: c.status, expired: c.expired, expDate: c.expDate, resellerCode: c.resellerCode }));
}

export function publicConfig(base) {
  return {
    ok: true,
    brand: BRAND.name,
    tagline: BRAND.tagline,
    siteUrl: base,
    whatsapp: WA_LINK,
    whatsappNumber: WA_NUMBER,
    ownerEmail: OWNER_EMAIL,
    plans: PLANS.map((p) => ({ id: p.id, label: p.label || p.id, days: p.days, devices: p.devices, direct: p.direct ?? null, reseller: p.reseller ?? null })),
    pricing: { currency: PANEL.currency, directPerUserMonthly: PANEL.directPerUserMonthly, resellerPerUserMonthly: PANEL.resellerPerUserMonthly, trialDays: PANEL.trialDays },
    selfServe: { enabled: SELF_SERVE.enabled, signupCredits: SELF_SERVE.signupCredits, unitCost: SELF_SERVE.unitCost, pricePresets: SELF_SERVE.pricePresets, allowMacClients: SELF_SERVE.allowMacClients },
    player: { recommended: PANEL.recommendedPlayer, name: PANEL.recommendedPlayerName },
    endpoints: {
      playerApi: `${base}/player_api.php`, m3u: `${base}/get.php`, epg: `${base}/xmltv.php`,
      magPortal: `${base}/portal.php`, embed: `${base}/api/embed`, panel: `${base}/api/panel`
    }
  };
}
