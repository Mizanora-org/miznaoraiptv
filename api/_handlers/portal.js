/**
 * MAG / Stalker-compatible live TV portal.
 * Supports handshake, profile, genres, ordered/all channel lists, create_link,
 * EPG and watchdog. MAC registration is mandatory; tokens are MAC-bound.
 * This is a lightweight portal, not a full Ministra middleware installation.
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, normalizeMac, checkRateLimit, corsHeaders } from "../_lib/util.js";
import { stalkerHandshake, stalkerProfile, listStalkerClients, listChannels, getClient, getShortEpg, getSettings } from "../_lib/store.js";
import { authenticateAdmin } from "../_lib/auth.js";

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("="); if (index < 0) return ["", ""];
    try { return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]; } catch { return [part.slice(0, index).trim(), ""]; }
  }).filter(([key]) => key));
}
const portalError = (res, status, message) => sendJson(res, status, { ok: false, error: message, js: { error: message, status: -1 } });
const genreKey = (channel) => String(channel.category || channel.categoryId || "General");

export default async function portalHandler(req, res) {
  if (handleOptions(req,res)) return;
  const q = parseQuery(req), jar = cookies(req), ep = String(q.ep || "portal"), base = getRequestBaseUrl(req);
  try {
    if (!checkRateLimit(req, "portal", 240, 60_000).allowed) return portalError(res, 429, "Rate limit");
    const action = String(q.action || (ep === "stalker" && !String(q.rest || "").replace(/\/$/, "").endsWith("/c") ? "get_profile" : ""));
    const auth = String(req.headers.authorization || "");
    const token = String(q.token || jar.token || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""));
    const mac = normalizeMac(q.mac || jar.mac || req.headers["x-mac"] || "");
    const type = String(q.type || "itv").toLowerCase();

    if (ep === "list") {
      const admin = await authenticateAdmin(req);
      if (!admin.ok) return portalError(res, admin.status || 401, admin.error);
      return sendJson(res, 200, { ok: true, clients: await listStalkerClients() });
    }
    if (action === "handshake") {
      if (!mac) return portalError(res, 400, "Valid MAC required");
      const session = await stalkerHandshake(mac);
      res.setHeader("Set-Cookie", [`token=${session.token}; Path=/; HttpOnly; SameSite=Lax${base.startsWith("https:") ? "; Secure" : ""}`, `mac=${encodeURIComponent(mac)}; Path=/; HttpOnly; SameSite=Lax${base.startsWith("https:") ? "; Secure" : ""}`]);
      return sendJson(res, 200, { js: { token: session.token, random: session.token.slice(0, 16), stb: { mac, portal: `${base}/c/`, version: "Mizanora 6.0" }, msg: "Mizanora IPTV MAG portal", exp: session.exp } });
    }
    if ((ep === "c" || ep === "portal" || ep === "stalker") && !action && !q.type) {
      // Static /c/ is the human setup page. Protocol roots retain a useful JSON
      // descriptor, and /c/portal.php without an action explains the endpoints.
      if (ep === "portal") return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", portal: `${base}/c/`, endpoint: `${base}/portal.php`, message: "Use a registered MAC with Stalker actions." });
      res.writeHead(302, { Location: "/c/", "Cache-Control": "no-store", ...corsHeaders() }); return res.end();
    }
    if (!mac || !token) return portalError(res, 403, "Handshake with a registered MAC first");
    const profile = await stalkerProfile(mac, token);
    if (!profile || profile.status !== "active") return portalError(res, 403, "Invalid/expired token, unregistered MAC or inactive subscription");
    const client = await getClient(profile.username);
    if (!client || client.status !== "active" || client.mac !== mac) return portalError(res, 403, "MAC client not found or inactive");
    const expiry = Number(client.expDate || 0);

    if (action === "get_profile" || action === "get_main_info") {
      const main = action === "get_main_info";
      return sendJson(res, 200, { js: {
        token, mac, id: client.username, login: client.username, name: client.name || client.username,
        fname: client.name || client.username, status: 0, stb_type: "MAG250", stb: { status: "active", username: client.username, mac },
        user: { status: "active", exp_date: String(expiry) }, expire_billing_date: expiry,
        tariff_plan: client.planId || "monthly", tariff_expired_date: expiry,
        ...(main ? { ver: "ImageDescription: Mizanora 6.0", portal: `${base}/c/`, support: "Contact your reseller" } : {}),
        msg: "Mizanora IPTV — active"
      } });
    }
    if (action === "watchdog" || action === "get_status") return sendJson(res, 200, { js: { status: 0, mac, token, cur_play_type: type, expire_billing_date: expiry } });
    if (action === "get_modules") return sendJson(res, 200, { js: [{ id: "itv", name: "TV", version: "6.0", status: 1 }, { id: "epg", name: "TV guide", version: "6.0", status: 1 }] });

    const channels = (await listChannels()).filter((c) => c.status !== "inactive");
    const categories = [], categoryIds = new Map();
    for (const channel of channels) {
      const key = genreKey(channel);
      if (!categoryIds.has(key)) { const id = String(categories.length + 1); categoryIds.set(key, id); categories.push({ id, title: key, alias: key, number: Number(channel.channelNumber) || categories.length + 1 }); }
    }
    const records = channels.map((channel, index) => {
      const streamId = Number(channel.streamId) || index + 1;
      const url = `${base}/live/${encodeURIComponent(client.username)}/${encodeURIComponent(client.password)}/${streamId}.m3u8`;
      return { id: String(streamId), name: channel.name, number: String(Number(channel.channelNumber) || index + 1), cmd: `ffmpeg ${url}`, url,
        logo: channel.logo || "", tv_genre_id: categoryIds.get(genreKey(channel)), genre_id: categoryIds.get(genreKey(channel)),
        epg_id: channel.epgId || channel.id || String(streamId), xmltv_id: channel.epgId || "", status: channel.status === "offline" ? 0 : 1,
        enable_tv_archive: 0, enable_monitoring: 0, open: 1 };
    });
    if (action === "get_genres") return sendJson(res, 200, { js: categories });
    if (action === "get_all_channels") return sendJson(res, 200, { js: records });
    if (action === "get_ordered_list") {
      if (!["itv", "tv", "live", ""].includes(type)) return sendJson(res, 200, { js: { data: [], total_items: 0, max_page_items: 0, cur_page: 1 } });
      const page = Math.max(1, Math.floor(Number(q.p) || 1)), perPage = Math.max(1, Math.min(100, Math.floor(Number(q.per_page || q.max_page_items) || 100)));
      const genre = String(q.genre || q.category || "*"), search = String(q.search || "").toLowerCase();
      let filtered = records.filter((record) => (genre === "*" || genre === "all" || genre === "0" || String(record.tv_genre_id) === genre || genreKey(channels.find((c) => String(c.streamId) === record.id) || {}) === genre) && (!search || record.name.toLowerCase().includes(search)));
      if (q.sortby === "name") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      if (q.sortby === "number") filtered = [...filtered].sort((a, b) => Number(a.number) - Number(b.number));
      const data = filtered.slice((page - 1) * perPage, page * perPage);
      return sendJson(res, 200, { js: { data, total_items: filtered.length, max_page_items: perPage, selected_item: 0, cur_page: page } });
    }
    if (action === "create_link") {
      const requested = String(q.cmd || q.url || "");
      const record = records.find((r) => requested === r.cmd || requested === r.url || requested === r.id || requested === `/ch/${r.id}` || requested.includes(`/${r.id}.m3u8`));
      if (!record) return portalError(res, 404, "Channel not found");
      return sendJson(res, 200, { js: { id: record.id, cmd: record.url, url: record.url, stream_url: record.url, error: "", use_http_tmp_link: 0, enable_monitoring: 0 } });
    }
    if (["get_short_epg", "get_epg_info", "get_epg"].includes(action)) {
      const reference = String(q.channel_id || q.ch_id || q.stream_id || q.id || "");
      const channel = channels.find((c) => [String(c.streamId), c.id, c.epgId].includes(reference));
      if (!channel) return portalError(res, 404, "Channel not found");
      const listings = await getShortEpg(channel, { limit: 20 });
      return sendJson(res, 200, { js: { data: listings.map((p) => ({ id: p.id, ch_id: reference, title: p.title, name: p.title, descr: p.description || "", start_timestamp: Math.floor(p.start / 1000), stop_timestamp: Math.floor(p.stop / 1000), category: p.category || "" })) } });
    }
    if (action === "do_auth") return sendJson(res, 200, { js: { status: 0, token, mac, id: client.username } });
    return portalError(res, 400, `Unsupported Stalker action: ${action || "none"}`);
  } catch (error) {
    console.error("portal error:", error);
    return portalError(res, error.status || 500, error.message || "Portal request failed");
  }
}
