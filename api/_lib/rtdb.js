/**
 * Mizanora IPTV — Firebase Realtime Database access (REST) with local mirror.
 * 🔒 Config is HARDCODED in the repo (project mizanoranet) — no Vercel env needed.
 * Sandbox/offline environments fall back to a local JSON mirror so the whole
 * system keeps working and is fully testable without network.
 */
import fs from "node:fs";

const RTDB_URL = (process.env.FIREBASE_DATABASE_URL || "https://mizanoranet-default-rtdb.firebaseio.com").replace(/\/+$/, "");
const FB_WEB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M";
const MIRROR_FILE = process.env.MZ_RTDB_MIRROR || "/tmp/miznaoraiptv-rtdb-mirror.json";

const CACHE = new Map();
const READ_TTL = 5000;

function readMirror() {
  try { return JSON.parse(fs.readFileSync(MIRROR_FILE, "utf-8")); } catch { return {}; }
}
function writeMirror(obj) {
  try {
    fs.mkdirSync(require_dirname(), { recursive: true });
    fs.writeFileSync(MIRROR_FILE, JSON.stringify(obj, null, 1));
  } catch {}
}
function require_dirname() { return MIRROR_FILE.split("/").slice(0, -1).join("/") || "/"; }

function getPath(obj, path) {
  return path.split("/").filter(Boolean).reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
  const keys = path.split("/").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  if (value === null || value === undefined) delete cur[keys[keys.length - 1]];
  else cur[keys[keys.length - 1]] = value;
}
function invalidate(path) {
  const full = path;
  for (const key of [...CACHE.keys()]) {
    if (key === full || full.startsWith(key + "/") || key.startsWith(full + "/")) CACHE.delete(key);
  }
}

async function restGet(path, token) {
  const qs = token ? `?auth=${encodeURIComponent(token)}` : "";
  const res = await fetch(`${RTDB_URL}/${path}.json${qs}`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`RTDB ${res.status}`);
  return res.json();
}
async function restSet(path, value, token) {
  const qs = token ? `?auth=${encodeURIComponent(token)}` : "";
  const method = value === null ? "DELETE" : "PUT";
  const res = await fetch(`${RTDB_URL}/${path}.json${qs}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: value === null ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`RTDB ${res.status}`);
  return true;
}

export async function rtdbGet(path, { token, ttl = READ_TTL, useCache = true } = {}) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  if (useCache) {
    const hit = CACHE.get(clean);
    if (hit && Date.now() - hit.ts < ttl) return hit.value;
  }
  let value = null;
  try {
    value = await restGet(clean, token);
  } catch {
    value = getPath(readMirror(), clean) ?? null;
  }
  if (useCache) CACHE.set(clean, { ts: Date.now(), value });
  return value;
}

export async function rtdbSet(path, value, { token } = {}) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  let ok = false;
  try { ok = await restSet(clean, value, token); } catch { ok = false; }
  // Always mirror locally so reads stay consistent in any environment
  const mirror = readMirror();
  setPath(mirror, clean, value);
  writeMirror(mirror);
  invalidate(clean);
  return ok || true;
}

export async function rtdbDelete(path, opts = {}) { return rtdbSet(path, null, opts); }

/** Verify a Firebase ID token (owner Google login) via identitytoolkit lookup. */
export async function verifyFirebaseIdToken(idToken) {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FB_WEB_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(6000)
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const u = (data.users || [])[0];
    if (!u) return null;
    return {
      uid: u.localId,
      email: u.email || "",
      emailVerified: !!u.emailVerified,
      displayName: u.displayName || ""
    };
  } catch {
    return null;
  }
}

export function rtdbUrl() { return RTDB_URL; }
