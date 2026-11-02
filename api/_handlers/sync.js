import { handleOptions, parseBody, sendJson } from "../_lib/origin.js";
import { updateLocalMirrorNode } from "../_lib/rtdb.js";
import { clearDeliveryCache } from "../_lib/hls.js";
import { isFirebaseAdmin } from "../_lib/admin-auth.js";
import { checkRateLimit } from "../_lib/security.js";
import { recordClientError } from "../_lib/tracker.js";

/**
 * Mirrors client Firebase RTDB updates to the in-process / local cache so
 * immediate Xtream / M3U8 / SEO requests reflect updates with zero delay.
 */
export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== "POST") {
    return sendJson(res, 200, { ok: true, message: "Mizanora RTDB Sync Active" });
  }

  // Client error beacons (purane deploys /api/sync par bhejte hain) — inhe
  // 204 de do taake browser console me 403 na aaye; real mirror ops admin-only.
  const earlyBody = await parseBody(req);
  if (earlyBody && (earlyBody.type === "error" || earlyBody.type === "js_error")) {
    const brl = checkRateLimit(req, "sync_beacon", 40, 60_000);
    if (!brl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit exceeded" }, "no-store");
    await recordClientError(req, earlyBody);
    res.writeHead(204, { "Cache-Control": "no-store" });
    return res.end();
  }

  if (!(await isFirebaseAdmin(req))) {
    return sendJson(res, 403, { ok: false, error: "Administrator authentication required" }, "no-store");
  }

  const rl = checkRateLimit(req, "sync", 90, 60_000);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: "Too many sync requests" });
  }

  const body = earlyBody || {};
  const path = String(body.path || "").trim();
  if (!path || path.includes("..")) {
    return sendJson(res, 400, { ok: false, error: "Invalid path" });
  }
  const allowedPrefixes = [
    "channels",
    "movies",
    "series",
    "settings/defaults",
    "xtreamAccounts/",
    "playlists/",
    "blogs",
    "reviews"
  ];
  if (!allowedPrefixes.some((p) => path === p || path.startsWith(p))) {
    return sendJson(res, 403, { ok: false, error: "Path not mirrorable" });
  }
  updateLocalMirrorNode(path, body.value);
  clearDeliveryCache();
  return sendJson(res, 200, { ok: true, synced: path });
}
