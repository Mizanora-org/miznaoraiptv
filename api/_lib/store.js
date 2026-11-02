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
import { sha256, randomHex, randomPassword, signPayload, normalizeMac, isValidEmail, serverSecret, WA_LINK, WA_NUMBER, OWNER_EMAIL } from "./util.js";
import { hashApiKey, generateAdminApiKey, generateResellerApiKey } from "./auth.js";
import { BRAND, DEFAULT_SETTINGS, DEFAULT_CHANNELS } from "../../data/catalog.js";
import { DEFAULT_MOVIES, DEFAULT_SERIES } from "../../data/imdb-seed.js";
import { PANEL, SELF_SERVE, PLANS, getPlan } from "../../data/panel.js";
import { parseM3U } from "./m3u.js";
import { parseXmlTv } from "./epg.js";

export { BRAND, PANEL, SELF_SERVE, PLANS, getPlan, DEFAULT_SETTINGS, DEFAULT_CHANNELS };

const nowIso = () => new Date().toISOString();
const ROOT = "panel";
const CACHE = new Map();
const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : Object.values(value || {}).filter(Boolean);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function cleanMediaUrl(value, { required = false } = {}) {
  const url = String(value || "").trim();
  if (!url && !required) return "";
  if (!url || url.length > 2000 || !(/^(https?:\/\/|\/)[^\s]*$/i.test(url))) {
    throw fail("Stream/image URL must be a valid http(s) URL or an absolute /path.", 400);
  }
  return url;
}

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
  const requested = String(input.username || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  let username = requested;
  if (username && await getClient(username)) throw fail(`Username '${username}' already exists.`, 409);
  if (!username) {
    // Generated usernames must also be unique; never silently overwrite a client.
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = "mz" + randomHex(4);
      if (!await getClient(candidate)) { username = candidate; break; }
    }
  }
  if (!username) throw fail("Could not allocate a unique username. Please retry.", 503);
  const password = String(input.password || "").trim().slice(0, 80) || randomPassword(10);
  const days = Math.max(1, Math.min(3650, Number(input.days) || plan.days || 30));
  const startTs = Number(input.startTs) || Math.floor(Date.now() / 1000);
  const mac = normalizeMac(input.mac || "") || "";
  if (String(input.mac || "").trim() && !mac) throw fail("Invalid MAC address (expected 00:1A:79:XX:XX:XX).", 400);
  if (mac) {
    const clash = (await listClients()).find((c) => String(c.mac || "").toUpperCase() === mac);
    if (clash) throw fail(`MAC address is already assigned to ${clash.username}.`, 409);
  }
  const client = {
    username, password,
    email: String(input.email || "").trim().toLowerCase().slice(0, 120),
    whatsapp: String(input.whatsapp || "").trim().slice(0, 30),
    name: String(input.name || input.displayName || "").trim().slice(0, 80),
    resellerCode: String(input.resellerCode || "").trim().toUpperCase(),
    planId: plan.id, plan: "pro", tier: "pro",
    status: "active",
    devices: Math.max(1, Math.min(20, Number(input.devices) || plan.devices || 1)),
    mac,
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
  const clean = { ...patch };
  delete clean.username; delete clean.daysLeft; delete clean.expired; delete clean.action; delete clean.createdAt;
  if (clean.mac !== undefined) {
    const mac = normalizeMac(clean.mac || "");
    if (String(clean.mac || "").trim() && !mac) throw fail("Invalid MAC address.", 400);
    if (mac) {
      const clash = (await listClients()).find((c) => c.username !== client.username && String(c.mac || "").toUpperCase() === mac);
      if (clash) throw fail(`MAC address is already assigned to ${clash.username}.`, 409);
    }
    clean.mac = mac;
  }
  if (clean.status !== undefined) clean.status = clean.status === "suspended" ? "suspended" : "active";
  if (clean.devices !== undefined) clean.devices = Math.max(1, Math.min(20, Number(clean.devices) || 1));
  const updated = { ...client, ...clean, username: client.username };
  await writeNode(`clients/${client.username}`, updated);
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
  const key = String(username || "").toLowerCase();
  if (!await getClient(key)) throw fail("Client not found.", 404);
  await writeNode(`clients/${key}`, null);
  await rtdbSet(`xtreamAccounts/${key}`, null);
  await pushAudit("client.deleted", { username: key });
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
  const code = String(input.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "RS" + randomHex(4).toUpperCase();
  if (await getResellerByCode(code)) throw fail(`Reseller code '${code}' already exists.`, 409);
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
    planId: plan.id, days: plan.days || 30,
    audience: "direct",
    amount: Math.max(0, Number(plan.direct) || 0),
    via: String(input.via || "whatsapp").slice(0, 30),
    status: "pending", proof: String(input.proof || "").slice(0, 500),
    resellerCode: "",
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
    amount: Math.max(0, Number(input.amount || 0)),
    months: Math.max(0, Math.min(120, Number(input.months || 0))),
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
  if (email && !isValidEmail(email)) return { ok: false, error: "Valid email required" };
  if (!email && !deviceId) return { ok: false, error: "Email ya device id required" };
  const all = (await readNode("trials")) || {};
  const existing = Object.values(all).find((t) => (email && t.email === email) || (deviceId && t.deviceId === deviceId));
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
export async function setSettings(patch = {}) {
  const cur = await getSettings();
  const clean = {};
  const urlFields = new Set(["welcomeVideoUrl", "channelOfflineVideoUrl", "comingSoonVideoUrl", "proUnlockVideoUrl"]);
  const boolFields = new Set(["welcomeVideoEnabled", "welcomeSkippable", "proUnlockVideoEnabled"]);
  const textFields = new Set(["proWhatsapp", "proWhatsappIntl", "proBannerTitle", "proBannerSubtitle", "proPriceNote", "siteAnnouncement", "rechargeNote", "resellerContactNote"]);
  for (const [key, value] of Object.entries(patch || {})) {
    if (urlFields.has(key)) clean[key] = cleanMediaUrl(value);
    else if (boolFields.has(key)) clean[key] = value === true || value === "true";
    else if (textFields.has(key)) clean[key] = String(value ?? "").slice(0, key === "siteAnnouncement" || key.endsWith("Note") ? 500 : 1000);
  }
  if (patch.welcomeDurationSec !== undefined) clean.welcomeDurationSec = Math.max(1, Math.min(30, Number(patch.welcomeDurationSec) || 4));
  const next = { ...cur, ...clean, updatedAt: nowIso() };
  await rtdbSet("settings/defaults", next);
  return next;
}

export async function getPublicExperience() {
  const settings = await getSettings();
  return {
    intro: {
      enabled: settings.welcomeVideoEnabled !== false && !!settings.welcomeVideoUrl,
      url: settings.welcomeVideoUrl || "",
      durationSec: Math.max(1, Math.min(30, Number(settings.welcomeDurationSec) || 4)),
      skippable: settings.welcomeSkippable !== false
    },
    announcement: settings.siteAnnouncement || "",
    rechargeNote: settings.rechargeNote || "JazzCash / EasyPaisa / WhatsApp se recharge karein.",
    resellerContactNote: settings.resellerContactNote || "Reseller account aur credit top-up ke liye support se rabta karein.",
    pro: {
      whatsapp: settings.proWhatsapp || WA_NUMBER,
      whatsappIntl: settings.proWhatsappIntl || WA_LINK.split("/").pop(),
      title: settings.proBannerTitle || "Unlock Mizanora IPTV PRO VIP",
      subtitle: settings.proBannerSubtitle || "",
      priceNote: settings.proPriceNote || ""
    }
  };
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
export async function recordAnalyticsEvent(req, body = {}) {
  const id = String(body.sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) throw fail("sessionId is required", 400);
  const event = String(body.event || "page_view").replace(/[^a-z_]/g, "").slice(0, 30) || "page_view";
  const allowed = new Set(["page_view", "stream_play", "trial_claim", "order_created"]);
  if (!allowed.has(event)) throw fail("Unsupported analytics event", 400);
  const path = `analytics/sessions/${id}`;
  const previous = (await readNode(path)) || {};
  const at = nowIso();
  const session = {
    id, event,
    route: String(body.route || "/").slice(0, 180),
    firstSeenAt: previous.firstSeenAt || at,
    lastSeenAt: at,
    plays: Number(previous.plays || 0) + (event === "stream_play" ? 1 : 0)
  };
  await writeNode(path, session);
  const analytics = (await rtdbGet("panel/analytics", { useCache: false })) || {};
  const counters = {
    totalSessions: Number(analytics.totalSessions || 0) + (previous.firstSeenAt ? 0 : 1),
    totalPlays: Number(analytics.totalPlays || 0) + (event === "stream_play" ? 1 : 0),
    totalPageViews: Number(analytics.totalPageViews || 0) + (event === "page_view" ? 1 : 0)
  };
  await rtdbSet("panel/analytics/counters", counters);
  return { ok: true, id };
}

export async function getAnalytics() {
  const a = (await rtdbGet("panel/analytics")) || {};
  const counters = a.counters || {};
  const sessions = asArray(a.sessions).sort((x, y) => String(y.lastSeenAt || "").localeCompare(String(x.lastSeenAt || "")));
  const activeCutoff = Date.now() - 5 * 60_000;
  const durations = sessions.map((s) => Math.max(0, new Date(s.lastSeenAt || 0) - new Date(s.firstSeenAt || 0)) / 1000).filter(Number.isFinite);
  const clients = await listClients();
  const orders = await listOrders();
  return {
    onlineNow: sessions.filter((s) => new Date(s.lastSeenAt || 0).getTime() >= activeCutoff).length,
    totalSessions: Number(counters.totalSessions ?? a.totalSessions ?? sessions.length),
    totalPlays: Number(counters.totalPlays ?? a.totalPlays ?? 0),
    totalPageViews: Number(counters.totalPageViews || 0),
    avgSessionSec: durations.length ? Math.round(durations.reduce((sum, n) => sum + n, 0) / durations.length) : 0,
    recentSessions: sessions.slice(0, 20),
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
  return Object.entries(all).map(([id, k]) => {
    const { hash, ...safe } = k;
    return { ...safe, id: k.id || id };
  }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
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
export async function revokeApiKeyByHash(hashOrId) {
  const all = (await readNode("apiKeys")) || {};
  for (const [id, k] of Object.entries(all)) {
    if (k.hash === hashOrId || id === hashOrId || k.id === hashOrId) {
      await writeNode(`apiKeys/${id}`, { ...k, id: k.id || id, revoked: true, revokedAt: nowIso() });
      clearPanelCache();
      await pushAudit("apikey.revoked", { id });
      return true;
    }
  }
  return false;
}

/* ---------------- channels / playlists / VOD catalogs ---------------- */
export async function listChannels() {
  const arr = asArray(await rtdbGet("channels"));
  return arr.length ? arr : DEFAULT_CHANNELS;
}

function channelPatch(input = {}, existing = {}) {
  const name = String(input.name ?? existing.name ?? "").trim().slice(0, 120);
  if (!name) throw fail("Channel name is required.", 400);
  const url = cleanMediaUrl(input.url ?? existing.url, { required: true });
  const category = String(input.category ?? existing.category ?? "General").trim().slice(0, 120) || "General";
  return {
    ...existing,
    name, url, category,
    categoryId: String(input.categoryId ?? existing.categoryId ?? category).slice(0, 40),
    logo: cleanMediaUrl(input.logo ?? existing.logo),
    epgId: String(input.epgId ?? existing.epgId ?? "").slice(0, 120),
    tier: String(input.tier ?? existing.tier ?? "free").toLowerCase() === "pro" ? "pro" : "free",
    status: String(input.status ?? existing.status ?? "active").toLowerCase() === "inactive" ? "inactive" : "active",
    updatedAt: nowIso()
  };
}

export async function createChannel(input = {}) {
  const channels = await listChannels();
  const id = String(input.id || "ch_" + randomHex(5)).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 48);
  if (channels.some((c) => String(c.id) === id)) throw fail("Channel ID already exists.", 409);
  const streamId = Math.max(1000, ...channels.map((c) => Number(c.streamId) || 0)) + 1;
  const channel = { ...channelPatch(input), id, streamId, order: channels.length + 1, createdAt: nowIso() };
  channels.push(channel);
  await rtdbSet("channels", channels);
  await pushAudit("channel.created", { id, name: channel.name });
  return channel;
}

export async function updateChannel(id, input = {}) {
  const channels = await listChannels();
  const index = channels.findIndex((c) => String(c.id) === String(id));
  if (index < 0) throw fail("Channel not found.", 404);
  channels[index] = channelPatch(input, channels[index]);
  await rtdbSet("channels", channels);
  await pushAudit("channel.updated", { id });
  return channels[index];
}

export async function deleteChannel(id) {
  const channels = await listChannels();
  const next = channels.filter((c) => String(c.id) !== String(id));
  if (next.length === channels.length) throw fail("Channel not found.", 404);
  await rtdbSet("channels", next.map((c, i) => ({ ...c, order: i + 1 })));
  await pushAudit("channel.deleted", { id });
  return true;
}

export async function listMovies() {
  const list = asArray(await rtdbGet("movies"));
  return list.length ? list : DEFAULT_MOVIES;
}
export async function listSeries() {
  const list = asArray(await rtdbGet("series"));
  return list.length ? list : DEFAULT_SERIES;
}
export async function updateMovie(id, input = {}) {
  const movies = await listMovies();
  const index = movies.findIndex((m) => String(m.id) === String(id) || String(m.streamId) === String(id));
  if (index < 0) throw fail("Movie not found.", 404);
  const streamUrl = cleanMediaUrl(input.streamUrl ?? input.url ?? movies[index].streamUrl);
  movies[index] = { ...movies[index], streamUrl, updatedAt: nowIso() };
  await rtdbSet("movies", movies);
  await pushAudit("movie.updated", { id: movies[index].id, playable: !!streamUrl });
  return movies[index];
}
export async function updateSeries(id, input = {}) {
  const series = await listSeries();
  const index = series.findIndex((s) => String(s.id) === String(id) || String(s.seriesId) === String(id));
  if (index < 0) throw fail("Series not found.", 404);
  const current = series[index];
  const episodes = asArray(current.episodes).map((ep) => {
    const supplied = asArray(input.episodes).find((x) => String(x.id) === String(ep.id));
    return supplied ? { ...ep, streamUrl: cleanMediaUrl(supplied.streamUrl ?? supplied.url ?? ep.streamUrl) } : ep;
  });
  series[index] = { ...current, episodes, updatedAt: nowIso() };
  await rtdbSet("series", series);
  await pushAudit("series.updated", { id: current.id });
  return series[index];
}

export async function listPlaylists() {
  return asArray(await rtdbGet("playlists")).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
export async function savePlaylist(input = {}) {
  const name = String(input.name || "").trim().slice(0, 100);
  if (!name) throw fail("Playlist name is required.", 400);
  const url = cleanMediaUrl(input.url, { required: true });
  const playlists = await listPlaylists();
  const id = String(input.id || "pl_" + randomHex(5)).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 48);
  const index = playlists.findIndex((p) => String(p.id) === id);
  const playlist = { ...(index >= 0 ? playlists[index] : {}), id, name, url, type: "m3u", updatedAt: nowIso() };
  if (index >= 0) playlists[index] = playlist; else playlists.push(playlist);
  await rtdbSet("playlists", playlists);
  await pushAudit(index >= 0 ? "playlist.updated" : "playlist.created", { id, name });
  return playlist;
}
export async function deletePlaylist(id) {
  const playlists = await listPlaylists();
  const next = playlists.filter((p) => String(p.id) !== String(id));
  if (next.length === playlists.length) throw fail("Playlist not found.", 404);
  await rtdbSet("playlists", next);
  await pushAudit("playlist.deleted", { id });
  return true;
}

/* ---------------- M3U channel imports ---------------- */
export async function importChannels(input = {}) {
  const parsed = parseM3U(String(input.content || ""), { baseUrl: input.sourceUrl || "", maxChannels: 5000 });
  const channels = await listChannels();
  const next = [...channels];
  let created = 0;
  let updated = 0;
  let nextStreamId = Math.max(1000, ...channels.map((c) => Number(c.streamId) || 0)) + 1;
  const defaultTier = String(input.defaultTier || "free").toLowerCase() === "pro" ? "pro" : "free";
  const normalizedName = (value) => String(value || "").trim().toLowerCase();

  for (const item of parsed.channels) {
    let index = next.findIndex((channel) => String(channel.id) === item.id);
    if (index < 0 && item.epgId) {
      index = next.findIndex((channel) => channel.source === "m3u-import" && normalizedName(channel.name) === normalizedName(item.name) && String(channel.epgId || "") === item.epgId);
    }
    const existing = index >= 0 ? next[index] : {};
    const patched = channelPatch({
      ...item,
      tier: index >= 0 ? existing.tier : defaultTier,
      status: index >= 0 ? existing.status : "active"
    }, existing);
    const channel = {
      ...patched,
      id: index >= 0 ? existing.id : item.id,
      streamId: index >= 0 ? existing.streamId : nextStreamId++,
      order: index >= 0 ? existing.order : next.length + 1,
      source: existing.source || "m3u-import",
      createdAt: existing.createdAt || nowIso()
    };
    if (index >= 0) { next[index] = channel; updated++; }
    else { next.push(channel); created++; }
  }
  await rtdbSet("channels", next);

  const sourceKey = String(input.sourceUrl || input.name || parsed.playlistName).slice(0, 1000);
  const playlistId = "pl_import_" + sha256(sourceKey).slice(0, 12);
  const playlists = await listPlaylists();
  const playlistIndex = playlists.findIndex((p) => p.id === playlistId);
  const previous = playlistIndex >= 0 ? playlists[playlistIndex] : {};
  const playlist = {
    ...previous,
    id: playlistId,
    name: String(input.name || parsed.playlistName || "Imported M3U").slice(0, 120),
    url: String(input.sourceUrl || "").slice(0, 2000),
    type: "m3u-import",
    channelCount: parsed.channels.length,
    epgUrls: parsed.epgUrls,
    updatedAt: nowIso(),
    createdAt: previous.createdAt || nowIso()
  };
  if (playlistIndex >= 0) playlists[playlistIndex] = playlist; else playlists.unshift(playlist);
  await rtdbSet("playlists", playlists);
  await pushAudit("channels.imported", { id: playlistId, created, updated, skipped: parsed.skipped });
  return { created, updated, imported: created + updated, skipped: parsed.skipped, total: next.length, errors: parsed.errors, epgUrls: parsed.epgUrls, playlist };
}

/* ---------------- XMLTV EPG sources + guide ---------------- */
const EMPTY_EPG = { sources: [], channels: [], programmes: [], updatedAt: "" };
export async function getEpgData() {
  const data = (await rtdbGet("epg")) || {};
  return {
    sources: asArray(data.sources),
    channels: asArray(data.channels),
    programmes: asArray(data.programmes),
    updatedAt: data.updatedAt || ""
  };
}
export async function listEpgSources() {
  const data = await getEpgData();
  return data.sources.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}
export async function importEpg(input = {}) {
  const parsed = parseXmlTv(String(input.content || ""));
  const sourceKey = String(input.sourceUrl || input.name || "upload").slice(0, 1000);
  const id = String(input.sourceId || "epg_" + sha256(sourceKey).slice(0, 12)).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 48);
  const current = await getEpgData();
  const programmes = current.programmes.filter((p) => p.sourceId !== id);
  const channels = current.channels.filter((c) => c.sourceId !== id);
  for (const p of parsed.programmes) programmes.push({ ...p, sourceId: id });
  for (const c of parsed.channels) channels.push({ ...c, sourceId: id });
  if (programmes.length > 60000) throw fail("Combined EPG data exceeds 60,000 programmes. Remove an old source first.", 413);
  programmes.sort((a, b) => Number(a.start) - Number(b.start));
  const previous = current.sources.find((s) => s.id === id) || {};
  const source = {
    ...previous, id,
    name: String(input.name || previous.name || (input.sourceUrl ? new URL(input.sourceUrl).hostname : "Uploaded XMLTV")).slice(0, 120),
    url: String(input.sourceUrl || previous.url || "").slice(0, 2000),
    channelCount: parsed.channels.length,
    programmeCount: parsed.programmes.length,
    skipped: parsed.skipped,
    updatedAt: nowIso(), createdAt: previous.createdAt || nowIso()
  };
  const sources = [...current.sources.filter((s) => s.id !== id), source];
  await rtdbSet("epg", { sources, channels, programmes, updatedAt: nowIso() });
  await pushAudit("epg.imported", { id, channels: parsed.channels.length, programmes: parsed.programmes.length });
  return { source, channels: parsed.channels.length, programmes: parsed.programmes.length, skipped: parsed.skipped, errors: parsed.errors };
}
export async function deleteEpgSource(id) {
  const current = await getEpgData();
  if (!current.sources.some((s) => s.id === id)) throw fail("EPG source not found.", 404);
  const next = {
    sources: current.sources.filter((s) => s.id !== id),
    channels: current.channels.filter((c) => c.sourceId !== id),
    programmes: current.programmes.filter((p) => p.sourceId !== id),
    updatedAt: nowIso()
  };
  await rtdbSet("epg", next);
  await pushAudit("epg.deleted", { id });
  return true;
}

function channelProgrammes(data, channel) {
  const ids = new Set([channel.epgId, channel.id, String(channel.streamId || "")].filter(Boolean));
  const normalized = String(channel.name || "").trim().toLowerCase();
  for (const item of data.channels) {
    if (normalized && String(item.name || "").trim().toLowerCase() === normalized) ids.add(item.id);
  }
  return data.programmes.filter((p) => ids.has(p.channelId));
}
function publicProgramme(p) {
  if (!p) return null;
  return {
    id: p.id, channelId: p.channelId, start: Number(p.start), stop: Number(p.stop),
    title: p.title, subTitle: p.subTitle || "", description: p.description || "",
    category: p.category || "", icon: p.icon || "", episode: p.episode || "",
    rating: p.rating || "", isNew: !!p.isNew, isPremiere: !!p.isPremiere
  };
}
function guideEntry(channel, listings, at) {
  const sorted = [...listings].sort((a, b) => Number(a.start) - Number(b.start));
  const now = sorted.find((p) => Number(p.start) <= at && Number(p.stop) > at);
  const upcoming = sorted.filter((p) => Number(p.start) > at);
  const next = upcoming[0];
  return {
    channel: { id: channel.id, streamId: channel.streamId, name: channel.name, logo: channel.logo || "", epgId: channel.epgId || "", category: channel.category || "", nowPlaying: channel.nowPlaying || "" },
    now: publicProgramme(now), next: publicProgramme(next),
    upcoming: upcoming.slice(0, 10).map(publicProgramme)
  };
}
export async function getEpgGuide(channels, { at = Date.now(), channelId = "" } = {}) {
  const data = await getEpgData();
  const selected = channelId ? channels.filter((c) => [c.id, String(c.streamId), c.epgId].some((id) => String(id || "") === String(channelId))) : channels;
  const byChannel = new Map();
  for (const programme of data.programmes) {
    if (!byChannel.has(programme.channelId)) byChannel.set(programme.channelId, []);
    byChannel.get(programme.channelId).push(programme);
  }
  const nameIds = new Map();
  for (const item of data.channels) {
    const name = String(item.name || "").trim().toLowerCase();
    if (!nameIds.has(name)) nameIds.set(name, new Set());
    nameIds.get(name).add(item.id);
  }
  return selected.map((channel) => {
    const ids = new Set([channel.epgId, channel.id, String(channel.streamId || "")].filter(Boolean));
    for (const id of nameIds.get(String(channel.name || "").trim().toLowerCase()) || []) ids.add(id);
    const listings = [...ids].flatMap((id) => byChannel.get(id) || []);
    return guideEntry(channel, listings, Number(at));
  });
}
export async function getShortEpg(channel, { at = Date.now(), limit = 10 } = {}) {
  const data = await getEpgData();
  const listings = channelProgrammes(data, channel).sort((a, b) => Number(a.start) - Number(b.start));
  const startIndex = listings.findIndex((p) => Number(p.stop) > at);
  if (startIndex < 0) return [];
  return listings.slice(startIndex, startIndex + Math.max(1, Math.min(50, Number(limit) || 10))).map(publicProgramme);
}
export async function getXmlTvProgrammes() {
  return (await getEpgData()).programmes.map(publicProgramme);
}

/** Resolve a protocol stream reference without ever falling back to an unrelated channel. */
export async function resolveMedia(kind, reference) {
  const raw = String(reference || "").replace(/^\/+|\/+$/g, "");
  const parts = raw.split("/").filter(Boolean);
  const stripExt = (v) => String(v || "").replace(/\.(m3u8|mp4|m2ts|ts|mpd)$/i, "");
  const matches = (item, ref, keys) => {
    const target = stripExt(ref).toLowerCase();
    return keys.some((key) => String(item[key] ?? "").toLowerCase() === target);
  };
  if (kind === "live") {
    const ref = stripExt(parts[parts.length - 1]);
    const channel = (await listChannels()).find((c, i) => matches(c, ref, ["id", "streamId", "slug"]) || String(i + 1) === ref);
    if (!channel || channel.status === "inactive") return null;
    let url = channel.url;
    if (/\.mpd(?:$|\?)/i.test(url) && !/\.mpd$/i.test(raw)) {
      url = asArray(channel.backupUrls).find((u) => /\.m3u8(?:$|\?)/i.test(u)) || url;
    }
    return { kind, id: channel.id, title: channel.name, url, logo: channel.logo || "", tier: channel.tier || "free" };
  }
  if (kind === "movie") {
    const ref = stripExt(parts[parts.length - 1]);
    const movie = (await listMovies()).find((m) => matches(m, ref, ["id", "streamId", "imdbId"]));
    return movie?.streamUrl ? { kind, id: movie.id, title: movie.title, url: movie.streamUrl, logo: movie.poster || "" } : null;
  }
  if (kind === "series") {
    const seriesRef = stripExt(parts.length > 1 ? parts[0] : parts[parts.length - 1]);
    const episodeRef = stripExt(parts[parts.length - 1]);
    const all = await listSeries();
    const series = all.find((s) => matches(s, seriesRef, ["id", "seriesId", "imdbId"]));
    if (series) {
      const episode = asArray(series.episodes).find((ep) => String(ep.id) === episodeRef || `${ep.season}x${ep.episode}` === episodeRef);
      if (episode?.streamUrl) return { kind, id: episode.id, title: episode.title, url: episode.streamUrl, logo: series.poster || "" };
      return null;
    }
    // Also accept /series/user/pass/<episodeId>.mp4 links emitted by some players.
    for (const s of all) {
      const episode = asArray(s.episodes).find((ep) => String(ep.id) === episodeRef);
      if (episode?.streamUrl) return { kind, id: episode.id, title: episode.title, url: episode.streamUrl, logo: s.poster || "" };
    }
  }
  return null;
}

/* ---------------- signed stream links ---------------- */
const STREAM_SECRET = serverSecret("MZ_STREAM_SECRET", "mizanora-iptv-stream-v3");
export function signStreamFor(base, username, file = "index.m3u8", kind = "live") {
  const token = signPayload({ u: username, f: file, k: kind }, STREAM_SECRET, 900);
  return { url: `${base}/s/${token}`, token, expiresIn: 900 };
}

/* ---------------- stalker / MAG ---------------- */
export async function stalkerHandshake(mac) {
  mac = normalizeMac(mac);
  if (!mac) return null;
  const sessions = (await rtdbGet("stalkerSessions")) || {};
  const existing = sessions[mac.replace(/:/g, "")];
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
  return { mac, status: client ? (client.status === "suspended" || (client.expDate && client.expDate < Date.now() / 1000) ? "blocked" : "active") : "blocked", username: client?.username || "" };
}
export async function listStalkerClients() {
  const clients = await listClients();
  return clients.filter((c) => c.mac).map((c) => ({ username: c.username, mac: c.mac, status: c.status, expired: c.expired, expDate: c.expDate, resellerCode: c.resellerCode }));
}

export function publicConfig(base) {
  return {
    ok: true,
    version: "5.0.0",
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
      magPortal: `${base}/portal.php`, embed: `${base}/api/embed`, panel: `${base}/api/panel`,
      guide: `${base}/api/embed?action=guide`, resellerPanel: `${base}/reseller`, developers: `${base}/developers`
    }
  };
}
