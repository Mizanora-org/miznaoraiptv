/** M3U/M3U8 channel playlist parser (EXTINF, EXTGRP and x-tvg-url). */
import crypto from "node:crypto";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value) => String(value ?? "").replace(/[\r\n\0]/g, " ").trim();
const slug = (value) => clean(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function m3uAttributes(value) {
  const attributes = {};
  const input = String(value || "");
  const pattern = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(input))) attributes[match[1].toLowerCase()] = clean(match[2] ?? match[3] ?? match[4]);
  return attributes;
}

function splitInfo(line) {
  let quoted = false;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      if (!quoted) { quoted = true; quote = char; }
      else if (quote === char) quoted = false;
    }
    if (char === "," && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}

function importedUrl(raw, baseUrl) {
  const value = clean(raw);
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return !baseUrl && /^\//.test(value) && !/^\/\//.test(value) && !/\s/.test(value) ? value : "";
  }
}

function importedId(epgId, name, url) {
  const explicit = slug(epgId);
  if (explicit) return `ch_${explicit}`.slice(0, 64);
  const namePart = slug(name) || "channel";
  const hash = crypto.createHash("sha256").update(`${name}\n${url}`).digest("hex").slice(0, 8);
  return `ch_imp_${namePart}_${hash}`.slice(0, 64);
}

export function parseM3U(input, { baseUrl = "", maxChannels = 5000 } = {}) {
  if (typeof input !== "string" || !input.trim()) throw fail("M3U content is empty.");
  if (input.length > 5_000_000) throw fail("M3U upload exceeds the 5 MB limit.", 413);
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  const channels = [];
  const errors = [];
  let skipped = 0;
  const seen = new Set();
  const epgUrls = new Set();
  let pending = null;
  let playlistName = "Imported playlist";

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      const attrs = m3uAttributes(line.slice(7));
      for (const url of String(attrs["x-tvg-url"] || "").split(",").map((item) => item.trim()).filter(Boolean)) {
        try { epgUrls.add(baseUrl ? new URL(url, baseUrl).toString() : new URL(url).toString()); } catch { /* Ignore malformed optional EPG links. */ }
      }
      continue;
    }
    if (line.startsWith("#PLAYLIST:")) { playlistName = clean(line.slice(10)) || playlistName; continue; }
    if (line.startsWith("#EXTINF:")) {
      const [metadata, title] = splitInfo(line.slice(8));
      pending = { attributes: m3uAttributes(metadata), name: clean(title), category: "", line: index + 1 };
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      if (pending) pending.category = clean(line.slice(8));
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) {
      skipped++;
      if (errors.length < 40) errors.push({ line: index + 1, error: "Stream URL has no preceding EXTINF." });
      continue;
    }
    const current = pending;
    pending = null;
    const url = importedUrl(line, baseUrl);
    const name = current.name || current.attributes["tvg-name"] || `Channel ${channels.length + 1}`;
    if (!url) {
      skipped++;
      if (errors.length < 40) errors.push({ line: index + 1, name, error: "Invalid or unsupported stream URL." });
      continue;
    }
    const epgId = clean(current.attributes["tvg-id"] || current.attributes["tvg-name"] || name).slice(0, 160);
    const id = importedId(epgId, name, url);
    if (seen.has(id)) {
      skipped++;
      if (errors.length < 40) errors.push({ line: index + 1, name, error: `Duplicate channel ID ${id}.` });
      continue;
    }
    seen.add(id);
    const logoRaw = current.attributes["tvg-logo"] || "";
    const channel = {
      id,
      name: name.slice(0, 160),
      url,
      logo: logoRaw ? importedUrl(logoRaw, baseUrl) : "",
      epgId,
      category: clean(current.attributes["group-title"] || current.category || "Imported").slice(0, 120) || "Imported",
      language: clean(current.attributes["tvg-language"] || "").slice(0, 60),
      country: clean(current.attributes["tvg-country"] || "").slice(0, 40),
      source: "m3u-import",
      updatedAt: new Date().toISOString()
    };
    channels.push(channel);
    if (channels.length > maxChannels) throw fail(`M3U contains more than ${maxChannels} channels.`, 413);
  }
  if (!channels.length) throw fail(errors[0] ? `No valid channels imported: ${errors[0].error}` : "No valid EXTINF channels found.");
  return { playlistName, channels, epgUrls: [...epgUrls].slice(0, 5), skipped, errors };
}

export const m3uInternals = { splitInfo, importedUrl, importedId };
