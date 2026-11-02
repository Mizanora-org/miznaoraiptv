/**
 * Mizanora IPTV — MAG / Stalker portal (fresh rebuild)
 *   /portal.php?action=handshake&mac=…           → {type:"stb", token, …} (8h TTL)
 *   /stalker_portal/server/load.php?mac&token…   → STB profile
 *   /c/portal.php etc → short portal URL served to MAG boxes
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, normalizeMac, checkRateLimit } from "../_lib/util.js";
import { stalkerHandshake, stalkerProfile, listStalkerClients } from "../_lib/store.js";
import { authenticateAdmin } from "../_lib/auth.js";

export default async function portalHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const ep = String(q.ep || "portal");
  const base = getRequestBaseUrl(req);

  if (ep === "portal") {
    const rl = checkRateLimit(req, "portal", 120, 60_000);
    if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit" });
    const action = String(q.action || "handshake");
    const mac = normalizeMac(q.mac || "");
    if (action === "handshake") {
      if (!mac) return sendJson(res, 400, { ok: false, error: "MAC required" });
      const s = await stalkerHandshake(mac);
      return sendJson(res, 200, {
        js: {
          token: s.token, stb: { mac, portal: `${base}/stalker_portal/server/load.php`, version: "Mizanora 3.0" },
          msg: "Mizanora IPTV MAG portal", exp: s.exp
        }
      });
    }
    return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", portal: base });
  }

  if (ep === "stalker") {
    const mac = normalizeMac(q.mac || "");
    const token = String(q.token || "");
    const prof = await stalkerProfile(mac, token);
    if (!prof) return sendJson(res, 403, { ok: false, error: "Invalid/expired token", js: { token: "" } });
    return sendJson(res, 200, {
      js: {
        token, mac: prof.mac,
        stb: { status: prof.status, username: prof.username },
        user: { status: prof.status, exp_date: "" },
        msg: "Mizanora IPTV — " + prof.status
      }
    });
  }

  if (ep === "c") {
    // short portal link for MAG boxes: /c/ → portal landing
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Mizanora IPTV — MAG Portal</title>
<body style="background:#04120c;color:#eafff5;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><img src="/assets/img/brand/miznaoraiptv-logo.png" style="width:120px"><h2>📺 Mizanora IPTV</h2>
<p>MAG / Stalker portal: <b>${base}/portal.php</b></p><p>Apne box mein ye Portal URL set karein.</p></div></body>`);
  }

  if (ep === "list") {
    const admin = await authenticateAdmin(req);
    if (!admin.ok) return sendJson(res, admin.status || 401, { ok: false, error: admin.error });
    return sendJson(res, 200, { ok: true, clients: await listStalkerClients() });
  }

  return sendJson(res, 400, { ok: false, error: "Unknown portal ep" });
}
