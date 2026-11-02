/** Signed, short-lived stream resolver for live TV, movies and series. */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, verifyPayload, corsHeaders, serverSecret } from "../_lib/util.js";
import { rtdbGet } from "../_lib/rtdb.js";
import { resolveMedia } from "../_lib/store.js";

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
    if (payload.u !== "public") {
      const username = String(payload.u || "").toLowerCase();
      let acc = await rtdbGet(`xtreamAccounts/${username}`);
      if (!acc) {
        const clients = (await rtdbGet("panel/clients")) || {};
        const client = Object.values(clients).find((c) => c.username === username);
        if (client) acc = { status: client.status, expDate: client.expDate };
      }
      const expired = acc?.expDate && Number(acc.expDate) < Math.floor(Date.now() / 1000);
      if (!acc || String(acc.status || "").toLowerCase() === "suspended" || expired) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
        return res.end("Subscription is inactive or expired");
      }
    }

    const media = await resolveMedia(String(payload.k || "live"), payload.f);
    if (!media?.url || (payload.u === "public" && (media.kind !== "live" || media.tier === "pro"))) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() });
      return res.end("Stream is not configured or is no longer available");
    }
    const target = /^https?:\/\//i.test(media.url) ? media.url : base + (media.url.startsWith("/") ? media.url : "/" + media.url);

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
