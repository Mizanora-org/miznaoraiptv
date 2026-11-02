/**
 * Mizanora IPTV — Xtream Codes API (fresh rebuild)
 *   ep=player → /player_api.php   ep=get → /get.php (M3U)   ep=xmltv → /xmltv.php
 *   ep=file   → /live|/movie|/series/:u/:p/:file (auth + 302 to signed /s/ link or media)
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, verifyPayload, normalizeMac } from "../_lib/util.js";
import { rtdbGet } from "../_lib/rtdb.js";
import { signStreamFor, getChannels } from "../_lib/store.js";

async function findAccount(username) {
  const u = String(username || "").toLowerCase();
  const acc = await rtdbGet(`xtreamAccounts/${u}`);
  if (acc) return acc;
  const clients = (await rtdbGet("panel/clients")) || {};
  const c = Object.values(clients).find((x) => x.username === u);
  if (!c) return null;
  return {
    username: c.username, password: c.password, status: c.status === "suspended" ? "Suspended" : "Active",
    expDate: c.expDate, maxConnections: c.devices || 1, mac: c.mac || ""
  };
}
function isLive(acc) {
  return String(acc.status || "").toLowerCase() !== "suspended" && !(acc.expDate && Number(acc.expDate) < Math.floor(Date.now() / 1000));
}

export default async function xtreamHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const ep = String(q.ep || "player");
  const base = getRequestBaseUrl(req);

  /* ---- player_api.php ---- */
  if (ep === "player") {
    const u = String(q.username || ""), p = String(q.password || "");
    const acc = await findAccount(u);
    if (!acc || acc.password !== p) {
      return sendJson(res, 200, { user_info: { auth: 0, status: "Disabled", message: "Invalid credentials" } });
    }
    if (!isLive(acc)) {
      return sendJson(res, 200, { user_info: { auth: 0, status: "Expired", message: "Subscription expired — recharge WhatsApp 0306-2015326" } });
    }
    const channels = await getChannels();
    const cats = {};
    for (const ch of Object.values(channels || {})) {
      const cat = ch.category || "General";
      cats[cat] = (cats[cat] || 0) + 1;
    }
    return sendJson(res, 200, {
      user_info: {
        auth: 1, status: "Active", username: acc.username, password: acc.password,
        exp_date: String(acc.expDate || ""), max_connections: String(acc.maxConnections || 1),
        is_trial: "0", active_cons: "0", created_at: "", allowed_output_formats: ["m3u8", "ts"]
      },
      server_info: {
        url: base, port: "443", server_protocol: "https", rtmp_port: "8000",
        timezone: "Asia/Karachi", timestamp_now: Math.floor(Date.now() / 1000)
      },
      categories: { live: Object.entries(cats).map(([name, num], i) => ({ category_id: String(i + 1), category_name: name, parent_id: 0 })), movie: [], series: [] },
      available_channels: Object.values(channels || {}).map((ch, i) => ({
        num: i + 1, name: ch.name, category_id: "1",
        stream_type: "live", stream_id: String(ch.id || i + 1),
        stream_icon: ch.logo || "", epg_channel_id: "", custom_sid: "", tv_archive: 0, added: ""
      }))
    });
  }

  /* ---- get.php (M3U playlist) ---- */
  if (ep === "get") {
    const u = String(q.username || ""), p = String(q.password || "");
    const acc = await findAccount(u);
    if (!acc || acc.password !== p || !isLive(acc)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end("Invalid credentials or expired");
    }
    const channels = await getChannels();
    const type = String(q.type || "m3u");
    let out = "#EXTM3U\n";
    for (const [i, ch] of channels.entries()) {
      out += `#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${ch.name}" tvg-logo="${ch.logo || ""}" group-title="${ch.category || "General"}",${ch.name}\n`;
      out += `${base}/live/${u}/${p}/${ch.id || i + 1}.m3u8\n`;
    }
    res.writeHead(200, { "Content-Type": type.includes("plus") ? "application/vnd.apple.mpegurl" : "audio/mpegurl", "Content-Disposition": 'attachment; filename="playlist.m3u"' });
    return res.end(out);
  }

  /* ---- xmltv.php (EPG) ---- */
  if (ep === "xmltv") {
    const u = String(q.username || ""), p = String(q.password || "");
    const acc = await findAccount(u);
    if (!acc || acc.password !== p || !isLive(acc)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end("Invalid credentials");
    }
    const channels = await getChannels();
    let out = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Mizanora IPTV">\n';
    for (const [i, ch] of channels.entries()) {
      const id = ch.id || String(i + 1);
      out += `<channel id="${id}"><display-name>${ch.name}</display-name></channel>\n`;
    }
    out += "</tv>";
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    return res.end(out);
  }

  /* ---- live/movie/series file URLs: /live/:u/:p/:id.m3u8 ---- */
  if (ep === "file") {
    // rest = "<user>/<pass>/<file…>" (kind already stripped by the /live|/movie|/series prefix)
    const seg = String(q.rest || q.path || "").split("/").filter(Boolean);
    const kind = String(q.kind || "live");
    const u = seg[0] || "", p = seg[1] || "", file = seg.slice(2).join("/") || "index.m3u8";
    const acc = await findAccount(u);
    if (!acc || acc.password !== p || !isLive(acc)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      return res.end("Access denied — recharge WhatsApp 0306-2015326");
    }
    // redirect to short-lived HMAC signed link /s/<token>
    const signed = signStreamFor(base, u, file, kind);
    res.writeHead(302, { Location: signed.url });
    return res.end();
  }

  return sendJson(res, 400, { ok: false, error: "Unknown xtream ep" });
}
