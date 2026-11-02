/**
 * Mizanora IPTV — core HTTP + security + crypto utilities (fresh rebuild)
 */
import crypto from "node:crypto";

export const BRAND_NAME = "Mizanora IPTV";
export const OWNER_EMAIL = "muaaziqbal.vip@gmail.com";
export const BOOTSTRAP_PIN = process.env.MZ_OWNER_PIN || "03062015326";
export const WA_NUMBER = "03062015326";
export const WA_LINK = "https://wa.me/923062015326";

/** Use explicit production secrets, with the configured service-account key as
 * a non-public fallback instead of signing admin sessions with a repo constant. */
export function serverSecret(name, fallback) {
  if (process.env[name]) return process.env[name];
  if (process.env.FIREBASE_PRIVATE_KEY) return process.env.FIREBASE_PRIVATE_KEY;
  try {
    const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
    if (account.private_key) return account.private_key;
  } catch { /* rtdb reports malformed service-account JSON with a clear error */ }
  return fallback;
}

export function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-admin-token",
    ...extra
  };
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }
  return false;
}

export function sendJson(res, status, obj, cache = "no-store") {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": cache,
    ...corsHeaders()
  });
  res.end(body);
}

export function parseQuery(req) {
  try {
    return Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
  } catch {
    return {};
  }
}

export function parseBody(req, { maxBytes = 1_000_000 } = {}) {
  // Vercel may pre-parse JSON while the local Node server exposes a stream.
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return Promise.resolve(JSON.parse(req.body.toString("utf8"))); } catch { return Promise.resolve({}); }
  }
  if (req.readableEnded) return Promise.resolve({});
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > maxBytes) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export function getRequestBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const requestedProto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const proto = /^https?$/.test(requestedProto) ? requestedProto : "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  try { return new URL(`${proto}://${host}`).origin; }
  catch { return "http://localhost"; }
}

/* ---------------- security ---------------- */
const buckets = new Map();
export function checkRateLimit(req, key, max, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const k = `${key}:${ip}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
  b.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return { allowed: b.count <= max, remaining: Math.max(0, max - b.count) };
}

export function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
export function hmacSHA256(secret, data) {
  return crypto.createHmac("sha256", String(secret)).update(String(data)).digest("hex");
}
export function randomHex(n = 16) {
  return crypto.randomBytes(n).toString("hex");
}
export function randomPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function normalizeMac(mac) {
  const hex = String(mac || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  if (hex.length !== 12) return "";
  return hex.replace(/(..)(?=.)/g, "$1:");
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
}

export function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/** HMAC-SHA256 signed stream link payload, TTL seconds (default 15 min). */
export function signPayload(payload, secret, ttlSec = 900) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec };
  const data = b64url(JSON.stringify(body));
  const sig = hmacSHA256(secret, data);
  return `${data}.${sig}`;
}

export function verifyPayload(token, secret) {
  const [data, sig] = String(token || "").split(".");
  if (!data || !sig) return null;
  const expect = hmacSHA256(secret, data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(data, "base64url").toString("utf-8")); } catch { return null; }
  if (!body || Math.floor(Date.now() / 1000) > Number(body.exp || 0)) return null;
  return body;
}
