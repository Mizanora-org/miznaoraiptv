/**
 * Mizanora IPTV — dev server (fresh rebuild)
 * Serves public/ statically + routes /api/* and protocol rewrites (from
 * vercel.json) to api/*.js handlers. Binds 0.0.0.0 for live preview.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const API_DIR = path.join(ROOT, "api");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".mp4": "video/mp4", ".m4s": "video/mp4", ".m3u8": "application/vnd.apple.mpegurl", ".m3u": "audio/mpegurl",
  ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".mpd": "application/dash+xml",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
const rewrites = (vercel.rewrites || []).map((r) => ({ src: new RegExp("^" + r.source.replace(/\(\.\*\)/g, "(.*)").replace(/:([a-zA-Z]+)/g, "([^/]+)").replace(/\$/g, "$") + "$"), dest: r.destination }));

function matchRewrite(pathname) {
  for (const r of rewrites) {
    const m = pathname.match(r.src);
    if (m) {
      let dest = r.dest;
      m.slice(1).forEach((g, i) => { dest = dest.replace(new RegExp("\\$" + (i + 1), "g"), g); });
      const u = new URL(dest, "http://x");
      return { pathname: u.pathname, search: u.search };
    }
  }
  return null;
}

const handlerCache = new Map();
async function loadApiHandler(apiPathname) {
  const rel = apiPathname.replace(/^\/api\/?/, "");
  const file = path.join(API_DIR, rel.endsWith(".js") ? rel : rel + ".js");
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    if (!handlerCache.has(file)) handlerCache.set(file, (await import(pathToFileURL(file).href)).default);
    return handlerCache.get(file);
  }
  return null;
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const incoming = new URL(req.url, "http://localhost");
      let pathname = decodeURIComponent(incoming.pathname);
      if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

      const rw = matchRewrite(pathname);
      const effectivePath = rw ? rw.pathname : pathname;
      // merge original query with rewrite destination query (Vercel-style)
      const merged = new URLSearchParams(incoming.search);
      if (rw) for (const [k, v] of new URLSearchParams(rw.search).entries()) merged.set(k, v);
      const effectiveSearch = merged.toString() ? "?" + merged.toString() : "";

      if (effectivePath.startsWith("/api/")) {
        const fn = await loadApiHandler(effectivePath);
        if (fn) {
          req.url = effectivePath + effectiveSearch;
          req.query = Object.fromEntries(new URLSearchParams(effectiveSearch).entries());
          await fn(req, res);
          return;
        }
      }

      let relFile = effectivePath === "/" ? "index.html" : effectivePath.replace(/^\/+/, "");
      let diskPath = path.resolve(PUBLIC_DIR, relFile);
      const relative = path.relative(PUBLIC_DIR, diskPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) { res.writeHead(403); return res.end("Forbidden"); }
      if (!fs.existsSync(diskPath) && !path.extname(diskPath) && fs.existsSync(diskPath + ".html")) diskPath += ".html";
      if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("404 Not Found");
      }
      const ext = path.extname(diskPath).toLowerCase();
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (ext === ".html") res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
      if (ext === ".m3u8" || ext === ".mpd") res.setHeader("Cache-Control", "no-store");
      const stat = fs.statSync(diskPath);
      const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "Accept-Ranges": "bytes" };
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2] || 0));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
          res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` });
        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(diskPath, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(diskPath).pipe(res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`🌊 Mizanora IPTV server listening on http://${HOST}:${PORT}`);
  });
}
