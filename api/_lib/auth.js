/**
 * Mizanora IPTV — admin authentication: Firebase ID token (owner Google),
 * Owner PIN session (mzp_…), or admin API key (mzk_…). Fresh rebuild.
 */
import crypto from "node:crypto";
import { rtdbGet, rtdbSet, verifyFirebaseIdToken } from "./rtdb.js";
import { sha256, hmacSHA256, randomHex, b64url, serverSecret, BOOTSTRAP_PIN, OWNER_EMAIL } from "./util.js";

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
export async function authorizeReseller(req, body = {}) {
  const apiKey = String(req.headers["x-api-key"] || body.apiKey || "").trim();
  if (apiKey.startsWith("mzr_")) {
    const hash = hashApiKey(apiKey);
    const all = (await rtdbGet("panel/resellers")) || {};
    for (const [code, r] of Object.entries(all)) {
      if (r.apiKeyHash === hash && r.status !== "suspended") {
        return { ok: true, reseller: { code, ...r } };
      }
    }
    return { ok: false, status: 401, error: "Invalid reseller API key" };
  }
  const code = String(body.code || "").toUpperCase();
  const password = String(body.password || "");
  if (code && password) {
    const r = (await rtdbGet("panel/resellers")) || {};
    const rec = r[code];
    if (rec && rec.status !== "suspended" && rec.passwordHash === sha256(password)) {
      return { ok: true, reseller: { code, ...rec } };
    }
    return { ok: false, status: 401, error: "Invalid reseller credentials" };
  }
  return { ok: false, status: 401, error: "Reseller auth required (x-api-key: mzr_… or code+password)" };
}
