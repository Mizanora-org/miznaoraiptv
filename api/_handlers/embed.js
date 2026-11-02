import {
  getRequestBaseUrl,
  handleOptions,
  parseBody,
  parseQuery,
  sendJson
} from "../_lib/origin.js";
import { checkRateLimit } from "../_lib/security.js";
import { getChannels, getMovies, getSeries } from "../_lib/rtdb.js";
import { BRAND } from "../../data/catalog.js";
import { PLANS, PANEL, SELF_SERVE, PAYMENT } from "../../data/panel.js";
import panelHandler from "./panel.js";

/**
 * Mizanora IPTV — Public Embed API (CORS: *)
 * ---------------------------------------------------------------
 * Ye woh API hai jo KISI BHI website mein lag sakti hai:
 *
 *   GET  /api/embed?action=config         -> brand, plans, prices, support, links
 *   GET  /api/embed?action=channels       -> live channel list + play URLs (/ch/:slug)
 *   GET  /api/embed?action=movies         -> IMDb VOD catalog sample
 *   GET  /api/embed?action=series         -> IMDb series catalog sample
 *   POST /api/embed?action=order          -> create order (delegates to panel engine)
 *   POST /api/embed?action=trial          -> free 1-day PRO trial (delegates)
 *   POST /api/embed?action=reseller/register -> self-serve reseller signup
 *   GET  /api/embed?action=order-status&id=ORDER_ID
 *   GET  /api/embed?action=health
 *
 * Browser widget:  <script src="/embed.js" data-mz-widget="plans|channels|order|trial">
 * Docs page:       /embed.html
 */

const DELEGATED_POST = new Set(["order", "trial", "reseller/register", "recharge/contact"]);
const DELEGATED_GET = new Set(["order-status", "status"]);

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const rl = checkRateLimit(req, "mizanora_embed", 180, 60_000);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: "Too many requests. Please slow down." });
  }

  const q = parseQuery(req);
  let ep = String(q.action || q.ep || "config").trim().toLowerCase();
  if (ep === "embed") ep = "config";
  const base = getRequestBaseUrl(req);
  const isPost = req.method === "POST" || req.method === "PUT";

  /* ------------------------------ HEALTH ------------------------------ */
  if (ep === "health" || ep === "ping") {
    return sendJson(res, 200, { ok: true, brand: BRAND.name, time: new Date().toISOString() });
  }

  /* --------------------- PUBLIC CONFIG / PLANS / BRAND --------------------- */
  if (!isPost && (ep === "config" || ep === "brand" || ep === "plans" || ep === "pricing")) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        brand: {
          name: BRAND.name,
          tagline: BRAND.tagline,
          site: BRAND.siteUrl,
          logo: `${base}${BRAND.logoPrimary}`,
          logoSvg: `${base}/assets/img/brand/miznaoraiptv-logo.svg`,
          parent: BRAND.parentProject,
          parentUrl: BRAND.parentUrl,
          founder: BRAND.founder,
          location: BRAND.founderLocation
        },
        plans: PLANS.map((p) => ({
          id: p.id,
          name: p.name,
          urdu: p.urdu,
          days: p.days,
          months: p.months,
          direct: p.direct,
          reseller: p.reseller,
          badge: p.badge,
          tagline: p.tagline
        })),
        pricing: {
          currency: PANEL.currency,
          directPerUserMonthly: PANEL.directPerUserMonthly,
          resellerPerUserMonthly: PANEL.resellerPerUserMonthly,
          trialDays: PANEL.trialDays,
          minResellerCredits: PANEL.minResellerCredits
        },
        selfServe: {
          enabled: SELF_SERVE.enabled,
          signupCredits: SELF_SERVE.signupCredits,
          unitCost: SELF_SERVE.unitCost,
          allowMacClients: SELF_SERVE.allowMacClients
        },
        payment: {
          method: PAYMENT.method,
          number: PAYMENT.accountNumber,
          title: PAYMENT.accountTitle,
          whatsappProof: PAYMENT.whatsappProof
        },
        support: { phone: PANEL.supportPhoneDisplay, whatsapp: PANEL.supportWhatsapp },
        player: { name: PANEL.recommendedPlayerName, url: PANEL.recommendedPlayer },
        links: {
          site: base,
          widget: `${base}/embed.js`,
          api: `${base}/api/embed`,
          docs: `${base}/embed.html`,
          panel: `${base}/reseller`,
          admin: `${base}/admin`
        },
        protocols: {
          xtreamPlayerApi: `${base}/player_api.php`,
          getPhp: `${base}/get.php`,
          xmltv: `${base}/xmltv.php`,
          magPortal: `${base}/portal.php`
        },
        generatedAt: new Date().toISOString()
      },
      "public, max-age=120"
    );
  }

  /* --------------------------- LIVE CHANNEL LIST --------------------------- */
  if (!isPost && ep === "channels") {
    const channels = await getChannels();
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 80));
    const freeOnly = String(q.tier || "") === "free";
    const list = channels
      .filter((c) => (freeOnly ? c.tier !== "pro" : true))
      .slice(0, limit)
      .map((c) => ({
        id: c.streamId,
        slug: c.slug,
        name: c.name,
        logo: c.logo || `${base}${BRAND.logoPrimary}`,
        category: c.category,
        tier: c.tier || "free",
        hd: /4k|uhd/i.test(c.name || "") ? 4 : /hd/i.test(c.name || "") ? 1 : 0,
        playUrl: `${base}/ch/${c.slug}`
      }));
    return sendJson(
      res,
      200,
      { ok: true, brand: BRAND.name, count: list.length, total: channels.length, channels: list },
      "public, max-age=60"
    );
  }

  /* ------------------------------ VOD CATALOG ------------------------------ */
  if (!isPost && (ep === "movies" || ep === "vod")) {
    const movies = await getMovies();
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 48));
    const list = movies.slice(0, limit).map((m) => ({
      id: m.id || m.imdbId,
      imdbId: m.imdbId,
      title: m.title,
      year: m.year,
      rating: m.rating,
      genres: m.genres || [],
      category: m.category,
      poster: m.poster,
      backdrop: m.backdrop,
      type: "movie"
    }));
    return sendJson(res, 200, { ok: true, count: list.length, total: movies.length, items: list }, "public, max-age=300");
  }

  if (!isPost && ep === "series") {
    const series = await getSeries();
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 36));
    const list = series.slice(0, limit).map((s) => ({
      id: s.id || s.imdbId,
      imdbId: s.imdbId,
      title: s.title,
      year: s.year,
      rating: s.rating,
      genres: s.genres || [],
      category: s.category,
      poster: s.poster,
      backdrop: s.backdrop,
      type: "series"
    }));
    return sendJson(res, 200, { ok: true, count: list.length, total: series.length, items: list }, "public, max-age=300");
  }

  /* ------------- DELEGATE TO THE PANEL ENGINE (single source) ------------- */
  if ((isPost && DELEGATED_POST.has(ep)) || (!isPost && DELEGATED_GET.has(ep))) {
    const body = isPost ? await parseBody(req) : {};
    req.body = { ...body, action: ep };
    const passthrough = {};
    for (const [k, v] of Object.entries(q)) {
      if (k !== "ep" && k !== "action") passthrough[k] = v;
    }
    req.query = { ep: "panel", action: ep, ...passthrough };
    req.url = `/api/admin?ep=panel&action=${encodeURIComponent(ep)}`;
    return panelHandler(req, res);
  }

  return sendJson(res, 404, {
    ok: false,
    error: `Unknown embed endpoint '${ep}'.`,
    endpoints: ["config", "channels", "movies", "series", "order", "trial", "order-status", "reseller/register", "health"]
  });
}
