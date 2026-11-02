/** Mizanora IPTV — /api/embed (Vercel serverless entry). Fresh rebuild. */
import handler from "./_handlers/embed.js";
import { parseQuery } from "./_lib/util.js";
export default async function (req, res) {
  req.query = parseQuery(req);
  return handler(req, res);
}
