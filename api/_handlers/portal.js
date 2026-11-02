/**
 * MAG / Stalker middleware endpoints: handshake, profile, channel list and
 * create_link. Every TV endpoint requires a valid token and an active MAC client.
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, normalizeMac, checkRateLimit } from "../_lib/util.js";
import { stalkerHandshake, stalkerProfile, listStalkerClients, listChannels, getClient } from "../_lib/store.js";
import { authenticateAdmin } from "../_lib/auth.js";

export default async function portalHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const ep = String(q.ep || "portal");
  const base = getRequestBaseUrl(req);

  try {
    const rl = checkRateLimit(req, "portal", 180, 60_000);
    if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit" });
    const action = String(q.action || (ep === "stalker" ? "get_profile" : ""));
    const mac = normalizeMac(q.mac || req.headers["x-mac"] || "");

    if (action === "handshake") {
      if (!mac) return sendJson(res, 400, { ok: false, error: "Valid MAC required" });
      const s = await stalkerHandshake(mac);
      return sendJson(res, 200, {
        js: {
          token: s.token, random: s.token.slice(0, 16),
          stb: { mac, portal: `${base}/portal.php`, version: "Mizanora 4.0" },
          msg: "Mizanora IPTV MAG portal", exp: s.exp
        }
      });
    }

    if (ep === "list") {
      const admin = await authenticateAdmin(req);
      if (!admin.ok) return sendJson(res, admin.status || 401, { ok: false, error: admin.error });
      return sendJson(res, 200, { ok: true, clients: await listStalkerClients() });
    }

    // /c/portal.php remains a human-readable landing page when called without
    // a Stalker action; with Stalker parameters it behaves exactly like portal.php.
    if (ep === "c" && !action && !q.type) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mizanora IPTV — MAG Portal</title>
<body style="background:#04120c;color:#eafff5;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:24px"><img src="/assets/img/brand/miznaoraiptv-logo.png" alt="" style="width:120px"><h2>📺 Mizanora IPTV</h2>
<p>MAG / Stalker portal: <b>${base}/portal.php</b></p><p>Register your MAC in the admin panel, then use this portal URL on your box.</p></div></body>`);
    }

    if (ep === "portal" && !action && !q.type) {
      return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", portal: `${base}/portal.php`, message: "Use a registered MAC with Stalker actions." });
    }

    const auth = String(req.headers.authorization || "");
    const token = String(q.token || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""));
    const profile = await stalkerProfile(mac, token);
    if (!profile) return sendJson(res, 403, { ok: false, error: "Invalid/expired token or MAC", js: { token: "" } });
    if (profile.status !== "active") {
      return sendJson(res, 403, { ok: false, error: "MAC is not registered or subscription is inactive", js: { mac, status: "blocked", token: "" } });
    }
    const client = await getClient(profile.username);
    if (!client) return sendJson(res, 403, { ok: false, error: "MAC client not found" });

    if (action === "get_profile" || (!action && ep === "stalker")) {
      return sendJson(res, 200, {
        js: {
          token, mac: profile.mac, id: client.username, login: client.username,
          status: 0, stb_type: "MAG", stb: { status: "active", username: client.username, mac },
          user: { status: "active", exp_date: String(client.expDate || "") },
          expire_billing_date: client.expDate ? new Date(client.expDate * 1000).toISOString() : "",
          tariff_plan: client.planId || "monthly", msg: "Mizanora IPTV — active"
        }
      });
    }

    const channels = (await listChannels()).filter((c) => c.status !== "inactive");
    const categories = [];
    const categoryIds = new Map();
    for (const [i, c] of channels.entries()) {
      const id = String(c.categoryId || c.category || "General");
      if (!categoryIds.has(id)) {
        categoryIds.set(id, String(categoryIds.size + 1));
        categories.push({ id: categoryIds.get(id), title: c.category || "General", alias: id });
      }
    }
    const records = channels.map((c, i) => {
      const streamId = Number(c.streamId) || i + 1;
      const url = `${base}/live/${encodeURIComponent(client.username)}/${encodeURIComponent(client.password)}/${streamId}.m3u8`;
      return {
        id: String(streamId), name: c.name, number: String(i + 1),
        cmd: `ffmpeg ${url}`, url,
        logo: c.logo || "", tv_genre_id: categoryIds.get(String(c.categoryId || c.category || "General")),
        genre_id: categoryIds.get(String(c.categoryId || c.category || "General")),
        epg_id: c.epgId || c.id || String(streamId), xmltv_id: c.epgId || "",
        status: 1, enable_tv_archive: 0, enable_monitoring: 0
      };
    });

    if (action === "get_genres") return sendJson(res, 200, { js: categories });
    if (action === "get_all_channels") return sendJson(res, 200, { js: records });
    if (action === "get_ordered_list") {
      const page = Math.max(1, Number(q.p) || 1);
      const perPage = Math.max(1, Math.min(100, Number(q.per_page) || 100));
      let filtered = records;
      if (q.genre) filtered = filtered.filter((c) => String(c.tv_genre_id) === String(q.genre));
      const data = filtered.slice((page - 1) * perPage, page * perPage);
      return sendJson(res, 200, { js: { data, total_items: filtered.length, max_page_items: perPage, selected_item: 0, cur_page: page } });
    }
    if (action === "create_link") {
      const requested = String(q.cmd || q.url || "");
      const record = records.find((r) => requested === r.cmd || requested === r.url || requested.includes(`/live/${encodeURIComponent(client.username)}/${encodeURIComponent(client.password)}/${r.id}.m3u8`) || requested === r.id);
      if (!record) return sendJson(res, 404, { ok: false, error: "Channel not found" });
      // Returning the authenticated /live URL lets the normal Xtream file
      // endpoint issue a fresh HMAC token; no permanent upstream URL is exposed.
      return sendJson(res, 200, { js: { id: record.id, cmd: record.url, url: record.url, error: "" } });
    }

    if (!action && ep === "portal") return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", portal: `${base}/portal.php` });
    return sendJson(res, 400, { ok: false, error: `Unsupported Stalker action: ${action || "none"}` });
  } catch (error) {
    console.error("portal error:", error);
    return sendJson(res, error.status || 500, { ok: false, error: error.message || "Portal request failed" });
  }
}
