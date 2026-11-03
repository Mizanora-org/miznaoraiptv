/** Bounded remote document loading for owner-triggered M3U/XMLTV imports. */
import dns from "node:dns/promises";
import net from "node:net";
import zlib from "node:zlib";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const LOCAL_IMPORTS = process.env.VERCEL !== "1";

function privateAddress(address) {
  const ip = String(address || "").toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    if (net.isIPv4(mapped)) return privateAddress(mapped);
    const hexadecimal = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexadecimal) {
      const high = Number.parseInt(hexadecimal[1], 16), low = Number.parseInt(hexadecimal[2], 16);
      return privateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("ff") || ip.startsWith("fe8") ||
    ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb");
}

async function validateRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail("A valid absolute http(s) import URL is required."); }
  if (!/^https?:$/.test(url.protocol)) throw fail("Only http(s) import URLs are supported.");
  if (url.username || url.password) throw fail("URL userinfo is not accepted; use normal M3U query credentials instead.");
  const host = url.hostname.toLowerCase();
  if (!LOCAL_IMPORTS && (host === "localhost" || host.endsWith(".local") || host === "metadata.google.internal")) {
    throw fail("Private/local import hosts are blocked in production.", 403);
  }
  if (net.isIP(host)) {
    if (!LOCAL_IMPORTS && privateAddress(host)) throw fail("Private IP imports are blocked in production.", 403);
  } else if (!LOCAL_IMPORTS) {
    let addresses;
    try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw fail("Import hostname could not be resolved.", 422); }
    if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
      throw fail("Import hostname resolves to a private network.", 403);
    }
  }
  return url;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes * 2) throw fail(`Remote document is too large (limit ${Math.round(maxBytes / 1_000_000)} MB).`, 413);
  const chunks = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes * 2) throw fail(`Remote document exceeded the ${Math.round(maxBytes / 1_000_000)} MB import limit.`, 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function fetchRemoteText(value, { maxBytes = 5_000_000, timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = await validateRemoteUrl(value);
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "application/xml,text/xml,text/plain,application/vnd.apple.mpegurl,application/x-mpegurl,application/gzip,*/*", "User-Agent": "Mizanora-Importer/5.0" },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now()))
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw fail("Remote import returned a redirect without a location.", 422);
      try { await response.body?.cancel(); } catch { /* Redirect body is not needed. */ }
      url = await validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(fail(`Remote import returned HTTP ${response.status}.`, 422), { upstreamStatus: response.status }); }
    let buffer = await readBounded(response, maxBytes);
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try { buffer = zlib.gunzipSync(buffer, { maxOutputLength: maxBytes }); }
      catch { throw fail("Gzip document is invalid or exceeds the import limit.", 413); }
    }
    if (buffer.length > maxBytes) throw fail(`Imported document exceeds ${Math.round(maxBytes / 1_000_000)} MB.`, 413);
    return {
      text: new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, ""),
      url: url.toString(),
      contentType: response.headers.get("content-type") || ""
    };
  }
  throw fail("Too many remote import redirects.", 422);
}

export const remoteImportInternals = { privateAddress, validateRemoteUrl };

/** Owner-triggered, bounded source probe. This is a point-in-time check, not
 * continuous monitoring or a promise that every player can decode the source. */
export async function probeMediaUrl(value, baseUrl = "") {
  const absolute = new URL(value, baseUrl || "http://localhost").toString();
  let url = await validateRemoteUrl(absolute);
  const started = Date.now();
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetch(url, {
      redirect: "manual", headers: { "User-Agent": "Mizanora-SourceCheck/6.0", Range: "bytes=0-65535", Accept: "application/vnd.apple.mpegurl,video/*,*/*" },
      signal: AbortSignal.timeout(8000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw fail("Source redirect has no location.", 422);
      url = await validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    const type = response.headers.get("content-type") || "";
    let valid = response.ok;
    if (valid && /mpegurl|xml|text/i.test(type)) {
      const text = (await readBounded(response, 65536)).toString("utf8");
      valid = text.includes("#EXTM3U") || text.includes("<MPD");
    } else {
      const reader = response.body?.getReader();
      const first = reader ? await reader.read() : { value: null };
      valid = valid && (first.value?.length > 0 || Number(response.headers.get("content-length")) > 0);
      await reader?.cancel();
    }
    return { online: valid, httpStatus: response.status, contentType: type, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
  }
  throw fail("Too many source redirects.", 422);
}
