/**
 * Firebase Realtime Database REST access.
 *
 * Local development keeps a JSON mirror when Firebase is unreachable. Vercel
 * needs a service account for durable, rules-authenticated server writes; a
 * serverless /tmp file is never treated as a successful production save.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const RTDB_URL = (process.env.FIREBASE_DATABASE_URL || "https://mizanoranet-default-rtdb.firebaseio.com").replace(/\/+$/, "");
const FB_WEB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M";
const MIRROR_FILE = process.env.MZ_RTDB_MIRROR || "/tmp/miznaoraiptv-rtdb-mirror.json";
const CACHE = new Map();
const READ_TTL = 5000;
const HEALTH = { lastReadOk: null, lastWriteOk: null, lastError: "", lastRemoteAt: "" };
let accessTokenCache = { value: "", exp: 0, pending: null };

function serviceAccount() {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.client_email && parsed.private_key) return parsed;
    }
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
      token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token"
    };
  }
  return null;
}
function hasServiceAccount() {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY));
}
async function serviceAccessToken() {
  if (!hasServiceAccount()) return "";
  if (accessTokenCache.value && Date.now() < accessTokenCache.exp) return accessTokenCache.value;
  if (accessTokenCache.pending) return accessTokenCache.pending;
  accessTokenCache.pending = (async () => {
    const account = serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
      aud: account.token_uri || "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600
    })}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), String(account.private_key).replace(/\\n/g, "\n")).toString("base64url");
    const assertion = `${unsigned}.${signature}`;
    const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
    const response = await fetch(tokenUri, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(`Firebase OAuth ${response.status}: ${data.error_description || data.error || "token failed"}`);
    accessTokenCache.value = data.access_token;
    accessTokenCache.exp = Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000;
    return data.access_token;
  })();
  try { return await accessTokenCache.pending; }
  finally { accessTokenCache.pending = null; }
}

function readMirror() {
  try { return JSON.parse(fs.readFileSync(MIRROR_FILE, "utf-8")); } catch { return {}; }
}
function writeMirror(obj) {
  try {
    const dir = MIRROR_FILE.split("/").slice(0, -1).join("/") || "/";
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${MIRROR_FILE}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(obj, null, 1));
    fs.renameSync(temp, MIRROR_FILE);
  } catch { /* Mirror is a development convenience only. */ }
}
function getPath(obj, path) {
  return path.split("/").filter(Boolean).reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
  const keys = path.split("/").filter(Boolean);
  if (!keys.length) return;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  if (value === null || value === undefined) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = value;
}
function invalidate(path) {
  for (const key of [...CACHE.keys()]) {
    if (key === path || path.startsWith(key + "/") || key.startsWith(path + "/")) CACHE.delete(key);
  }
}
async function remoteQuery(path, method, value, token) {
  if (process.env.MZ_RTDB_OFFLINE === "1") throw new Error("Firebase offline test mode");
  let qs = "";
  if (token) qs = `?auth=${encodeURIComponent(token)}`;
  else {
    const accessToken = await serviceAccessToken();
    if (accessToken) qs = `?access_token=${encodeURIComponent(accessToken)}`;
  }
  const response = await fetch(`${RTDB_URL}/${path}.json${qs}`, {
    method,
    headers: value === undefined ? undefined : { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`RTDB ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return method === "GET" ? response.json() : true;
}

export async function rtdbGet(path, { token, ttl = READ_TTL, useCache = true } = {}) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  if (useCache) {
    const hit = CACHE.get(clean);
    if (hit && Date.now() - hit.ts < ttl) return hit.value;
  }
  let value = null;
  try {
    value = await remoteQuery(clean, "GET", undefined, token);
    HEALTH.lastReadOk = true;
    HEALTH.lastError = "";
    HEALTH.lastRemoteAt = new Date().toISOString();
  } catch (error) {
    HEALTH.lastReadOk = false;
    HEALTH.lastError = error.message || String(error);
    value = getPath(readMirror(), clean) ?? null;
  }
  if (useCache) CACHE.set(clean, { ts: Date.now(), value });
  return value;
}

export async function rtdbSet(path, value, { token } = {}) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  let remoteOk = false;
  let failure = null;
  try {
    await remoteQuery(clean, value === null ? "DELETE" : "PUT", value === null ? undefined : value, token);
    remoteOk = true;
    HEALTH.lastWriteOk = true;
    HEALTH.lastError = "";
    HEALTH.lastRemoteAt = new Date().toISOString();
  } catch (error) {
    failure = error;
    HEALTH.lastWriteOk = false;
    HEALTH.lastError = error.message || String(error);
  }

  // Keep local development usable, but never acknowledge an ephemeral Vercel
  // /tmp write as durable data storage.
  const mirror = readMirror();
  setPath(mirror, clean, value);
  writeMirror(mirror);
  invalidate(clean);
  if (!remoteOk && (process.env.VERCEL === "1" || process.env.MZ_REQUIRE_PERSISTENCE === "1")) {
    const setup = hasServiceAccount() ? "Check Firebase service-account permissions." : "Configure FIREBASE_SERVICE_ACCOUNT_JSON in Vercel.";
    throw new Error(`Firebase save failed — ${setup} ${failure?.message || ""}`.trim());
  }
  return remoteOk;
}

export async function rtdbDelete(path, opts = {}) { return rtdbSet(path, null, opts); }

export function rtdbHealth() {
  return {
    database: RTDB_URL,
    configuredServiceAccount: hasServiceAccount(),
    durableServerWrites: hasServiceAccount() && HEALTH.lastWriteOk !== false,
    lastReadOk: HEALTH.lastReadOk,
    lastWriteOk: HEALTH.lastWriteOk,
    lastRemoteAt: HEALTH.lastRemoteAt,
    lastError: HEALTH.lastError,
    localMirror: !hasServiceAccount(),
    production: process.env.VERCEL === "1"
  };
}

/** Verify a Firebase ID token (owner Google login) via Identity Toolkit. */
export async function verifyFirebaseIdToken(idToken) {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FB_WEB_KEY)}`,
      {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(8000)
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const u = (data.users || [])[0];
    if (!u) return null;
    return { uid: u.localId, email: u.email || "", emailVerified: !!u.emailVerified, displayName: u.displayName || "" };
  } catch { return null; }
}

export function rtdbUrl() { return RTDB_URL; }
