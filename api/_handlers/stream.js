/**
 * Mizanora IPTV — signed stream links /s/<token> (HMAC-SHA256, TTL 900s), fresh rebuild.
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, verifyPayload } from "../_lib/util.js";
import { getChannels } from "../_lib/store.js";

const STREAM_SECRET = process.env.MZ_STREAM_SECRET || "mizanora-iptv-stream-v3";

export default async function streamHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const base = getRequestBaseUrl(req);
  if (String(q.ep || "signed") === "signed") {
    const payload = verifyPayload(String(q.token || ""), STREAM_SECRET);
    if (!payload) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      return res.end("Invalid or expired link");
    }
    // serve a tiny playlist pointing at the real channel stream
    const chId = String(payload.f || "").replace(/\.m3u8$/, "");
    const arr = await getChannels();
    const ch = arr.find((c) => String(c.id) === chId) || arr[0];
    const url = ch?.url || "/media/coming-soon/index.m3u8";
    const body = `#EXTM3U\n#EXTINF:-1,${ch?.name || "Mizanora IPTV"},\n${url.startsWith("http") ? url : base + url}\n`;
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end(body);
  }
  return sendJson(res, 400, { ok: false, error: "Unknown stream ep" });
}
