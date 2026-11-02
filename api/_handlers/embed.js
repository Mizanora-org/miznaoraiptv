/**
 * Mizanora IPTV — public embeddable API (CORS *), fresh rebuild.
 * /api/embed?action=config|channels|movies|series|order|trial|order-status|health
 * Widget: /embed.js  (any website: <script src="…/embed.js" data-mizanora-embed></script>)
 */
import { handleOptions, parseQuery, parseBody, sendJson, getRequestBaseUrl, corsHeaders, checkRateLimit, WA_LINK } from "../_lib/util.js";
import { rtdbGet } from "../_lib/rtdb.js";
import * as S from "../_lib/store.js";

export default async function embedHandler(req, res) {
  if (handleOptions(req, res)) return;
  const rl = checkRateLimit(req, "embed", 240, 60_000);
  if (!rl.allowed) return sendJson(res, 429, { ok: false, error: "Rate limit" });
  const q = parseQuery(req);
  const base = getRequestBaseUrl(req);
  const action = String(q.action || "config").toLowerCase();
  const isPost = req.method === "POST";
  const body = isPost ? await parseBody(req) : {};

  try {
    if (action === "health") return sendJson(res, 200, { ok: true, brand: "Mizanora IPTV", ts: Date.now() });
    if (action === "config") {
      return sendJson(res, 200, { ...S.publicConfig(base), embed: true }, "public, max-age=60");
    }
    if (action === "channels") {
      const list = (await S.getChannels()).map((c) => ({ id: c.id, name: c.name, logo: c.logo, category: c.category, group: c.category, tier: c.tier || "pro", previewVideo: c.previewVideoUrl || "", url: c.url }));
      return sendJson(res, 200, { ok: true, count: list.length, channels: list }, "public, max-age=60");
    }
    if (action === "movies" || action === "series") {
      const node = action === "movies" ? "movies" : "series";
      const raw = (await rtdbGet(node)) || {};
      const list = (Array.isArray(raw) ? raw : Object.values(raw)).slice(0, Number(q.limit) || 60)
        .map((m) => ({ id: m.id || m.tmdbId, title: m.title || m.name, poster: m.poster || m.poster_path, year: m.year || (m.release_date || "").slice(0, 4), rating: m.rating || m.vote_average }));
      return sendJson(res, 200, { ok: true, count: list.length, [action]: list }, "public, max-age=300");
    }
    if (action === "order" && isPost) {
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
      return o ? sendJson(res, 200, { ok: true, order: o }) : sendJson(res, 404, { ok: false, error: "Not found" });
    }
    return sendJson(res, 400, { ok: false, error: "Unknown embed action" });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
