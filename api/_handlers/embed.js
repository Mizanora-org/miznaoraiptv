/** Public embed/catalog API (CORS *). */
import { handleOptions, parseQuery, parseBody, sendJson, getRequestBaseUrl, checkRateLimit, WA_LINK, isValidEmail } from "../_lib/util.js";
import * as S from "../_lib/store.js";
import { rtdbHealth } from "../_lib/rtdb.js";

export default async function embedHandler(req, res) {
  if (handleOptions(req, res)) return;
  const rl = checkRateLimit(req, "embed", 300, 60_000);
  if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit" });
  const q = parseQuery(req);
  const base = getRequestBaseUrl(req);
  const action = String(q.action || "config").toLowerCase();
  const isPost = req.method === "POST";
  const body = isPost ? await parseBody(req) : {};

  try {
    if (action === "health") return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", ts: Date.now(), storage: rtdbHealth() });
    if (action === "help") {
      return sendJson(res, 200, {
        ok: true, brand: S.BRAND.name,
        actions: {
          "GET config": "Public plans and endpoints",
          "GET channels": "Live channel metadata",
          "GET guide&channel=CHANNEL_ID": "Now/next XMLTV guide (public, safe metadata)",
          "GET movies|series&limit=40&offset=0&q=": "Searchable IMDb catalog",
          "GET stream&id=CHANNEL_ID": "Short-lived preview URL (free channels only)",
          "POST order": "{name,email,whatsapp,planId}",
          "POST trial": "{email,deviceId?,whatsapp?}",
          "GET order-status&id=": "Order status"
        },
        widget: `${base}/embed.js`
      });
    }
    if (action === "config") return sendJson(res, 200, { ...S.publicConfig(base), embed: true, version: "6.1.1", experience: await S.getPublicExperience(), links: { resellerPanel: `${base}/reseller`, developers: `${base}/developers` } }, "public, max-age=60");
    if (action === "channels") {
      const list = (await S.listChannels()).filter((c) => c.status !== "inactive").map((c) => ({
        id: c.id, streamId: c.streamId, name: c.name, logo: c.logo,
        category: c.category, group: c.category, tier: c.tier || "free", channelNumber: c.channelNumber, order: c.order, status: c.status,
        epgId: c.epgId || "", nowPlaying: c.nowPlaying || ""
      }));
      return sendJson(res, 200, { ok: true, count: list.length, channels: list }, "public, max-age=60");
    }
    if (action === "guide") {
      const channels = (await S.listChannels()).filter((c) => c.status !== "inactive");
      const channelId = q.channel || q.id || "";
      const limit = Math.max(1, Math.min(200, Number(q.limit) || 100));
      // Avoid rendering thousands of unused entries on the default public view.
      const selected = channelId ? channels : channels.slice(0, limit);
      const guide = await S.getEpgGuide(selected, { channelId });
      const total = channelId ? guide.length : channels.length;
      const page = channelId ? guide.slice(0, limit) : guide;
      const sources = await S.listEpgSources();
      return sendJson(res, 200, { ok: true, count: page.length, total, guide: page, sources: sources.length, updatedAt: sources[0]?.updatedAt || "" }, "public, max-age=60");
    }
    if (action === "stream") {
      const channels = await S.listChannels();
      const channel = channels.find((c) => String(c.id) === String(q.id) || String(c.streamId) === String(q.id));
      if (!channel || channel.status === "inactive") return sendJson(res, 404, { ok: false, error: "Channel not found" });
      if (channel.tier === "pro") return sendJson(res, 403, { ok: false, error: "PRO channel — free trial ya subscription activate karein.", trialUrl: `${base}/#trial` });
      return sendJson(res, 200, { ok: true, channel: { id: channel.id, name: channel.name, logo: channel.logo }, ...S.signStreamFor(base, "public", String(channel.id), "live") });
    }
    if (action === "branding") {
      const record = await S.getResellerByCode(String(q.reseller || q.code || ""));
      if (!record || record.status === "suspended") return sendJson(res, 404, { ok: false, error: "Reseller branding not found" });
      const branding = record.branding || {};
      return sendJson(res, 200, { ok: true, branding: { service: record.name || "Mizanora IPTV reseller", business: branding.tagline || "Mizanora IPTV reseller business", paymentMethod: branding.paymentMethod || "", paymentAccount: branding.paymentAccount || "", paymentTitle: branding.paymentTitle || "", support: record.whatsapp || "" } }, "public, max-age=60");
    }
    if (action === "movies" || action === "series") {
      const source = action === "movies" ? await S.listMovies() : await S.listSeries();
      const search = String(q.q || q.search || "").trim().toLowerCase();
      let filtered = search ? source.filter((m) => `${m.title || m.name || ""} ${m.year || ""} ${(Array.isArray(m.genres) ? m.genres : []).join(" ")} ${m.category || ""}`.toLowerCase().includes(search)) : source;
      if (q.category) filtered = filtered.filter((m) => String(m.category || "") === String(q.category));
      if (q.ready === "1") filtered = filtered.filter((m) => m.streamUrl || Object.values(m.episodes || {}).some((ep) => ep.streamUrl));
      if (q.sort) filtered = S.sortCatalogRecords(filtered, String(q.sort));
      const limit = Math.max(1, Math.min(200, Number(q.limit) || 60));
      const offset = Math.max(0, Number(q.offset) || 0);
      const list = filtered.slice(offset, offset + limit).map((m) => ({
        id: m.id || m.tmdbId,
        streamId: m.streamId || m.seriesId,
        title: m.title || m.name,
        poster: m.poster || m.poster_path,
        backdrop: m.backdrop || "",
        year: m.year || (m.release_date || "").slice(0, 4),
        rating: m.imdbRating ?? m.rating ?? m.vote_average ?? "",
        category: m.category || "",
        genres: m.genres || [],
        plot: m.plot || "",
        streamAvailable: action === "movies" ? !!m.streamUrl : Object.values(m.episodes || {}).some((ep) => !!ep.streamUrl),
        episodeCount: action === "series" ? Object.values(m.episodes || {}).length : undefined,
        episodes: action === "series" ? Object.values(m.episodes || {}).map((ep) => ({ id: ep.id, title: ep.title, season: ep.season, episode: ep.episode, streamAvailable: !!ep.streamUrl })) : undefined
      }));
      return sendJson(res, 200, { ok: true, count: list.length, total: filtered.length, offset, limit, categories: [...new Set(source.map((item) => item.category).filter(Boolean))].sort(), [action]: list }, "public, max-age=60");
    }
    if (action === "order" && isPost) {
      if (!String(body.name || "").trim() || !isValidEmail(body.email) || String(body.whatsapp || "").replace(/\D/g, "").length < 10) {
        return sendJson(res, 400, { ok: false, error: "Valid name, email and WhatsApp are required" });
      }
      const o = await S.createOrder(body);
      return sendJson(res, 201, { ok: true, orderId: o.id, whatsapp: WA_LINK, message: "Order receive hua — WhatsApp par screenshot bhejein." });
    }
    if (action === "trial" && isPost) {
      const r = await S.claimTrial(body);
      if (!r.ok) return sendJson(res, 409, r);
      return sendJson(res, 201, { ok: true, username: r.client.username, password: r.client.password, expDate: r.client.expDate, links: { m3u: `${base}/get.php?username=${r.client.username}&password=${r.client.password}` } });
    }
    if (action === "order-status") {
      const o = await S.getOrder(String(body.id || q.id || "").toUpperCase());
      return o ? sendJson(res, 200, { ok: true, order: { id: o.id, status: o.status, planId: o.planId, amount: o.amount, createdAt: o.createdAt, clientUsername: o.clientUsername || "" } }) : sendJson(res, 404, { ok: false, error: "Not found" });
    }
    return sendJson(res, 400, { ok: false, error: "Unknown embed action" });
  } catch (err) {
    console.error("embed error:", err);
    return sendJson(res, err.status || 500, { ok: false, error: String(err?.message || err) });
  }
}
