/** Signed, short-lived stream resolver for live TV, movies and series. */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, verifyPayload, corsHeaders, serverSecret, signPayload, hmacSHA256 } from "../_lib/util.js";
import { rtdbGet } from "../_lib/rtdb.js";
import { resolveMedia, getSettings, getClient, getResellerByCode } from "../_lib/store.js";

import { gatewayConfig, gatewayAuthorized, gatewayLink } from "../_lib/gateway.js";

import { startHls, serveHls, PLAYOUT_TTL } from "../_lib/hls.js";

const STREAM_SECRET = serverSecret("MZ_STREAM_SECRET", "mizanora-iptv-stream-v3");

export default async function streamHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const base = getRequestBaseUrl(req);
  if (String(q.ep || "signed") !== "signed") return sendJson(res, 400, { ok: false, error: "Unknown stream endpoint" });

  try {
    const payload = verifyPayload(String(q.token || ""), STREAM_SECRET);
    if (!payload) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
      return res.end("Invalid or expired link");
    }

    // Public preview tokens are only valid for free live channels. Client tokens
    // stop working when the subscription is suspended or expires.
    const preview = payload.preview === true && payload.u === "owner-preview";
    let expired = false, credentialVersion = "";
    if (payload.u !== "public" && !preview) {
      const username = String(payload.u || "").toLowerCase();
      let acc = await rtdbGet(`xtreamAccounts/${username}`);
      if (!acc) {
        const clients = (await rtdbGet("panel/clients")) || {};
        const client = Object.values(clients).find((c) => c.username === username);
        if (client) acc = { status: client.status, expDate: client.expDate, password: client.password };
      }
      if (acc) credentialVersion = hmacSHA256(STREAM_SECRET, `${username}:${acc.password || ""}`);
      if (payload.cv && payload.cv !== credentialVersion) return sendJson(res, 403, { ok: false, error: "Credentials changed; sign in again" });
      expired = acc?.expDate && Number(acc.expDate) < Math.floor(Date.now() / 1000);
      if (!acc || String(acc.status || "").toLowerCase() === "suspended") {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
        return res.end("Subscription is inactive or expired");
      }
    }

    const previewCard = preview && ["offline", "recharge", "comingSoon"].includes(payload.card) ? payload.card : "";
    const media = previewCard ? { id: "preview-card", kind: "live", url: "/media/welcome/index.m3u8" } : await resolveMedia(String(payload.k || "live"), payload.f);
    if (!media?.url || (payload.u === "public" && (media.kind !== "live" || media.tier === "pro"))) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
      return res.end("Stream is not configured or is no longer available");
    }
    const target = /^https?:\/\//i.test(media.url) ? media.url : base + (media.url.startsWith("/") ? media.url : "/" + media.url);

    const settings = await getSettings();
    const fallback = previewCard || (expired ? "recharge" : media.comingSoon ? "comingSoon" : media.offline ? "offline" : "");
    if (expired && settings.proUnlockVideoEnabled === false) return sendJson(res, 403, { ok: false, error: "Subscription expired" });
    if (media.playbackMode === "direct" && !fallback) {
      res.writeHead(302, { Location: target, "Cache-Control": "no-store", "X-Mizanora-Playout": "direct", ...corsHeaders() });
      return res.end();
    }
    if (payload.hid) {
      const result = await serveHls(base, payload, target, fallback);
      if (result.redirect) {
        res.writeHead(302, { Location: result.redirect, "Cache-Control": "no-store", "X-Mizanora-Playout": "direct", "X-Mizanora-Reason": result.reason, ...corsHeaders() });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store, max-age=0", "X-Mizanora-Playout": result.mode, "X-Mizanora-Recovery": result.error ? (result.mode === "live" ? "retrying-source" : "source-unavailable") : "none", ...corsHeaders() });
      return res.end(result.manifest);
    }

    // Gateway authorization is server-to-server only; browser/public previews
    // keep their existing player-controlled intro and direct source behavior.
    const gateway = gatewayConfig();
    if (q.gateway === "authorize") {
      if (expired || !gateway || !gatewayAuthorized(req, gateway) || payload.u === "public" || media.kind !== "live") return sendJson(res, 403, { ok: false, error: "Gateway access denied" });
      const settings = await getSettings();
      const client = await getClient(String(payload.u).toLowerCase());
      const reseller = client?.resellerCode ? await getResellerByCode(client.resellerCode) : null;
      const branding = reseller?.branding || {};
      return sendJson(res, 200, { ok: true, url: target, offline: !!media.offline,
        title: `#${media.channelNumber || ""} ${media.title || "Live TV"}`,
        payment: `${branding.paymentMethod || settings.paymentMethod || ""} ${branding.paymentAccount || settings.paymentAccountNumber || ""} | ${branding.paymentTitle || settings.paymentAccountTitle || ""}`,
        contact: reseller?.whatsapp || settings.proWhatsapp || "", expires: payload.exp });
    }
    if (gateway && !preview && !expired && payload.u !== "public" && media.kind === "live") {
      const token = signPayload({ u: payload.u, f: payload.f, k: "live", cv: credentialVersion }, STREAM_SECRET, PLAYOUT_TTL);
      const callback = `${base}/api/stream?token=${encodeURIComponent(token)}&gateway=authorize`;
      res.writeHead(302, { Location: gatewayLink(gateway, callback), "Cache-Control": "no-store", ...corsHeaders() });
      return res.end();
    }

    if (payload.u !== "public" && (fallback || (media.kind === "live" && (preview || settings.serverlessHlsEnabled !== false)))) {
      // Conservative reconnect identity: account/credential/source binding is
      // inside startHls; only an HMAC is persisted, never the raw IP/UA.
      const reconnectContext = JSON.stringify([
        String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim(),
        String(req.headers["user-agent"] || "").slice(0, 512)
      ]);
      const location = await startHls(base, { ...payload, cv: credentialVersion }, media, target, { fallback, intro: settings.welcomeVideoEnabled !== false, reconnectContext });
      res.writeHead(302, { Location: location, "Cache-Control": "no-store", "X-Mizanora-Playout": location === target ? "direct" : "session", ...corsHeaders() });
      return res.end();
    }

    // Redirect to the actual source instead of wrapping it in a synthetic HLS
    // master playlist. The source may itself be a master playlist (which cannot
    // be used as a variant), and its relative segments/keys must resolve against
    // the provider's final URL. This also preserves the real media format.
    res.writeHead(302, { Location: target, "Cache-Control": "no-store", ...corsHeaders() });
    return res.end();
  } catch (error) {
    console.error("stream error:", error);
    return sendJson(res, error.status || 500, { ok: false, error: error.message || "Stream failed" });
  }
}
