/**
 * Mizanora IPTV — admin authentication: Firebase ID token (owner Google),
 * Owner PIN session (mzp_…), or admin API key (mzk_…). Fresh rebuild.
 */
import crypto from "node:crypto";
import { rtdbGet, rtdbSet, verifyFirebaseIdToken } from "./rtdb.js";
import { sha256, hmacSHA256, randomHex, b64url, serverSecret, signPayload, verifyPayload, checkRateLimit, BOOTSTRAP_PIN, OWNER_EMAIL } from "./util.js";
import { verifyPassword, verifyLegacyPassword, needsPasswordUpgrade, hashPassword } from "./password.js";

const SESSION_SECRET = serverSecret("MZ_SESSION_SECRET", "mizanora-iptv-v3-session-secret");
const SESSION_TTL_MS = 12 * 3600 * 1000;

export function isAdminEmail(email) {
  return String(email || "").toLowerCase() === OWNER_EMAIL;
}

/* ---------- API keys (mzk_ admin / mzr_ reseller) ---------- */
export function generateAdminApiKey() { return "mzk_" + randomHex(16); }
export function generateResellerApiKey() { return "mzr_" + randomHex(16); }
export function hashApiKey(key) { return sha256(String(key)); }

export async function findApiKeyByHash(hash) {
  const keys = (await rtdbGet("panel/apiKeys")) || {};
  for (const [id, k] of Object.entries(keys)) {
    if (k.hash === hash) return { id, ...k };
  }
  return null;
}

export async function verifyAdminApiKey(key) {
  if (!String(key || "").startsWith("mzk_")) return null;
  const rec = await findApiKeyByHash(hashApiKey(key));
  if (!rec || rec.revoked) return null;
  if (rec.expiresAt && Date.now() > Number(rec.expiresAt)) return null;
  await rtdbSet(`panel/apiKeys/${rec.id}/lastUsedAt`, Date.now());
  return { type: "apiKey", id: rec.id, label: rec.label || "" };
}

/* ---------- PIN sessions (mzp_…) ---------- */
export function createPinSession() {
  const payload = { uid: "owner_pin", email: OWNER_EMAIL, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const data = b64url(JSON.stringify(payload));
  return `mzp_${data}.${hmacSHA256(SESSION_SECRET, data)}`;
}
export function verifyPinSession(token) {
  if (!String(token || "").startsWith("mzp_")) return null;
  const [, rest] = String(token).split("mzp_");
  const [data, sig] = String(rest || "").split(".");
  if (!data || !sig) return null;
  const expect = hmacSHA256(SESSION_SECRET, data);
  const actualBytes = Buffer.from(String(sig));
  const expectedBytes = Buffer.from(expect);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (p.uid !== "owner_pin" || !isAdminEmail(p.email)) return null;
    if (!Number.isFinite(Number(p.exp)) || Date.now() > Number(p.exp)) return null;
    return { uid: p.uid, email: p.email };
  } catch { return null; }
}
export function verifyBootstrapPin(pin) {
  return String(pin || "").trim() === BOOTSTRAP_PIN;
}

/* ---------- unified admin auth for requests ---------- */
export async function authenticateAdmin(req) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  const pinToken = String(req.headers["x-admin-token"] || "").trim();

  if (bearer && !bearer.startsWith("mzk_")) {
    const user = await verifyFirebaseIdToken(bearer);
    if (!user) return { ok: false, status: 401, error: "Invalid Firebase token" };
    if (!user.emailVerified || !isAdminEmail(user.email)) {
      return { ok: false, status: 403, error: `⛔ Sirf ${OWNER_EMAIL} (verified) admin hai.` };
    }
    return { ok: true, via: "firebase", user };
  }
  if (apiKey.startsWith("mzk_")) {
    const rec = await verifyAdminApiKey(apiKey);
    if (!rec) return { ok: false, status: 401, error: "Invalid or revoked API key" };
    return { ok: true, via: "apiKey", user: { uid: "apikey", email: OWNER_EMAIL }, key: rec };
  }
  if (pinToken) {
    const sess = verifyPinSession(pinToken);
    if (!sess) return { ok: false, status: 401, error: "Invalid or expired PIN session" };
    return { ok: true, via: "pin", user: { uid: sess.uid, email: sess.email } };
  }
  return { ok: false, status: 401, error: "Admin auth required (Bearer token / x-api-key / x-admin-token)" };
}

/* ---------- reseller auth ---------- */
const RESELLER_SESSION_SECRET = serverSecret("MZ_SESSION_SECRET", "mizanora-iptv-reseller-v6-session");
export function createResellerSession(reseller) {
  return "mzs_" + signPayload({ code: reseller.code, ver: Number(reseller.authVersion || 0), role: "reseller" }, RESELLER_SESSION_SECRET, 12 * 3600);
}
export async function verifyResellerSession(token) {
  if (!String(token || "").startsWith("mzs_")) return null;
  const payload = verifyPayload(String(token).slice(4), RESELLER_SESSION_SECRET);
  if (!payload || payload.role !== "reseller" || !payload.code) return null;
  const all = (await rtdbGet("panel/resellers")) || {};
  const record = all[payload.code];
  if (!record || record.status === "suspended" || Number(record.authVersion || 0) !== Number(payload.ver)) return null;
  return { code: payload.code, ...record };
}
export async function verifyResellerPassword(record, password) {
  if (!record || !password) return false;
  if (needsPasswordUpgrade(record.passwordHash)) return verifyLegacyPassword(password, record.passwordHash);
  return verifyPassword(password, record.passwordHash);
}
export async function upgradeResellerPassword(code, password) {
  const record = await rtdbGet(`panel/resellers/${code}`);
  if (record && needsPasswordUpgrade(record.passwordHash)) {
    await rtdbSet(`panel/resellers/${code}/passwordHash`, await hashPassword(password));
  }
}
export async function authorizeReseller(req, body = {}) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const session = String(req.headers["x-reseller-token"] || body.resellerToken || (bearer.startsWith("mzs_") ? bearer : "")).trim();
  if (session) {
    const record = await verifyResellerSession(session);
    return record ? { ok: true, via: "session", reseller: record } : { ok: false, status: 401, error: "Reseller session expired. Please login again." };
  }
  const apiKey = String(req.headers["x-api-key"] || body.apiKey || "").trim();
  if (apiKey.startsWith("mzr_")) {
    const hash = hashApiKey(apiKey);
    const all = (await rtdbGet("panel/resellers")) || {};
    for (const [code, r] of Object.entries(all)) {
      if (r.apiKeyHash === hash && r.status !== "suspended") return { ok: true, via: "apiKey", reseller: { code, ...r } };
    }
    return { ok: false, status: 401, error: "Invalid reseller API key" };
  }
  const login = String(body.username || body.code || "").trim();
  const password = String(body.password || "");
  if (login && password) {
    const rl = checkRateLimit(req, `reseller_login:${login.toLowerCase()}`, 12, 15 * 60_000);
    if (!rl.allowed) return { ok: false, status: 429, error: "Too many login attempts. Try again in 15 minutes." };
    const all = (await rtdbGet("panel/resellers")) || {};
    const needle = login.toLowerCase();
    const entry = Object.entries(all).find(([code, r]) => code.toLowerCase() === needle || String(r.username || "").toLowerCase() === needle);
    if (entry && entry[1].status !== "suspended" && await verifyResellerPassword(entry[1], password)) {
      return { ok: true, via: "password", reseller: { code: entry[0], ...entry[1] } };
    }
    return { ok: false, status: 401, error: "Invalid reseller credentials" };
  }
  return { ok: false, status: 401, error: "Reseller authentication required (session, API key, or username + password)." };
}
