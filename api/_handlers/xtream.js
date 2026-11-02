/**
 * Mizanora IPTV — Xtream Codes compatible API.
 * Supports the actions IPTV Smarters/TiviMate actually call, not just login.
 */
import { handleOptions, parseQuery, sendJson, getRequestBaseUrl, corsHeaders } from "../_lib/util.js";
import { rtdbGet } from "../_lib/rtdb.js";
import {
  listChannels, listMovies, listSeries, signStreamFor, getShortEpg, getEpgData
} from "../_lib/store.js";
import { programmeXml } from "../_lib/epg.js";

const nowTs = () => Math.floor(Date.now() / 1000);
const asArray = (value) => Array.isArray(value) ? value.filter(Boolean) : typeof value === "string" ? (value ? [value] : []) : Object.values(value || {}).filter(Boolean);
const xml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
// M3U attributes are not XML: preserving '&' is essential for x-tvg-url query auth.
const m3uAttr = (value) => String(value ?? "").replace(/["\r\n\0]/g, " ").trim();
const extension = (url, fallback = "mp4") => String(url || "").match(/\.(mp4|mkv|avi|mov|m4v|mpd|m3u8)(?:$|\?)/i)?.[1]?.toLowerCase() || fallback;
const epgDate = (value) => new Date(Number(value)).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
const epgText = (value) => Buffer.from(String(value || ""), "utf8").toString("base64");
function epgListing(programme, channel, index) {
  const start = Math.floor(Number(programme.start) / 1000);
  const stop = Math.floor(Number(programme.stop) / 1000);
  return {
    id: String(index + 1), epg_id: String(channel.epgId || channel.id), title: epgText(programme.title), lang: "en",
    start: epgDate(programme.start), end: epgDate(programme.stop), description: epgText(programme.description),
    channel_id: String(programme.channelId), start_timestamp: String(start), stop_timestamp: String(stop),
    now_playing: start <= nowTs() && stop > nowTs() ? 1 : 0, has_archive: 0
  };
}

async function findAccount(username) {
  const u = String(username || "").toLowerCase();
  const acc = await rtdbGet(`xtreamAccounts/${u}`);
  if (acc) return acc;
  const clients = (await rtdbGet("panel/clients")) || {};
  const c = Object.values(clients).find((x) => x.username === u);
  if (!c) return null;
  return {
    username: c.username, password: c.password,
    status: c.status === "suspended" ? "Suspended" : "Active",
    expDate: c.expDate, maxConnections: c.devices || 1, mac: c.mac || "",
    createdAt: c.createdAt || "", planId: c.planId || "monthly"
  };
}
function isLive(acc) {
  return String(acc.status || "").toLowerCase() !== "suspended" && !(acc.expDate && Number(acc.expDate) < nowTs());
}
function sendText(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...corsHeaders(), ...extra });
  res.end(body);
}
function categoryData(items, prefix) {
  const categories = [];
  const seen = new Map();
  const byName = new Map();
  let sequence = 1;
  const generatedId = () => {
    let id;
    do { id = `${prefix}${sequence++}`; } while (seen.has(id));
    return id;
  };
  for (const item of items) {
    const name = String(item.category || "General");
    const explicit = String(item.categoryId || "");
    let id = byName.get(name) || "";
    if (!id && /^\d+$/.test(explicit) && (!seen.has(explicit) || seen.get(explicit) === name)) id = explicit;
    if (!id) id = generatedId();
    if (!seen.has(id)) {
      seen.set(id, name);
      categories.push({ category_id: id, category_name: name, parent_id: 0 });
    }
    if (!byName.has(name)) byName.set(name, id);
  }
  return categories;
}
function categoryIdFor(item, categories, prefix, index) {
  const name = String(item.category || "General");
  const explicit = String(item.categoryId || "");
  if (explicit && categories.some((c) => c.category_id === explicit && c.category_name === name)) return explicit;
  const found = categories.find((c) => c.category_name === name);
  return found?.category_id || `${prefix}${index + 1}`;
}
function liveStream(ch, index, categories) {
  const streamId = Number(ch.streamId) || index + 1;
  return {
    num: index + 1,
    name: ch.name,
    stream_type: "live",
    stream_id: streamId,
    stream_icon: ch.logo || "",
    epg_channel_id: ch.epgId || String(ch.id || streamId),
    added: ch.createdAt ? String(Math.floor(new Date(ch.createdAt).getTime() / 1000) || 0) : "0",
    category_id: categoryIdFor(ch, categories, "1", index),
    category_ids: [Number(categoryIdFor(ch, categories, "1", index)) || 0],
    custom_sid: "", tv_archive: 0,
    direct_source: "",
    is_adult: 0
  };
}
function movieStream(movie, index, categories) {
  const streamId = Number(movie.streamId) || 5001 + index;
  const rating = Number(movie.imdbRating ?? movie.rating ?? 0) || 0;
  return {
    num: index + 1,
    name: movie.title || movie.name,
    title: movie.title || movie.name,
    stream_type: "movie",
    stream_id: streamId,
    stream_icon: movie.poster || movie.poster_path || "",
    rating: String(rating),
    rating_5based: Math.round(rating / 2 * 10) / 10,
    added: "0",
    category_id: categoryIdFor(movie, categories, "10", index),
    category_ids: [Number(categoryIdFor(movie, categories, "10", index)) || 0],
    container_extension: extension(movie.streamUrl),
    direct_source: "",
    plot: movie.plot || "",
    cast: movie.cast || "",
    director: movie.director || "",
    genre: asArray(movie.genres).join(", "),
    release_date: movie.year || "",
    youtube_trailer: "",
    episode_run_time: movie.runtime || "",
    stream_available: movie.streamUrl ? 1 : 0
  };
}
function seriesStream(series, index, categories) {
  const rating = Number(series.imdbRating ?? series.rating ?? 0) || 0;
  return {
    num: index + 1,
    name: series.title || series.name,
    title: series.title || series.name,
    series_id: Number(series.seriesId) || 10001 + index,
    cover: series.poster || "",
    plot: series.plot || "",
    cast: series.cast || "",
    director: series.director || "",
    genre: asArray(series.genres).join(", "),
    release_date: series.year || "",
    last_modified: "0",
    rating: String(rating),
    rating_5based: Math.round(rating / 2 * 10) / 10,
    backdrop_path: series.backdrop ? [series.backdrop] : [],
    youtube_trailer: "",
    episode_run_time: series.runtime || "",
    category_id: categoryIdFor(series, categories, "20", index),
    category_ids: [Number(categoryIdFor(series, categories, "20", index)) || 0]
  };
}

export default async function xtreamHandler(req, res) {
  if (handleOptions(req, res)) return;
  const q = parseQuery(req);
  const ep = String(q.ep || "player");
  const base = getRequestBaseUrl(req);

  try {
    const fileParts = ep === "file" ? String(q.rest || q.path || "").split("/").filter(Boolean) : [];
    const u = String(q.username || (ep === "file" ? decodeURIComponent(fileParts[0] || "") : ""));
    const p = String(q.password || (ep === "file" ? decodeURIComponent(fileParts[1] || "") : ""));
    const acc = await findAccount(u);
    if (!acc || acc.password !== p || !isLive(acc)) {
      if (ep === "player") return sendJson(res, 200, { user_info: { auth: 0, status: "Disabled", message: "Invalid credentials or subscription expired" } });
      return sendText(res, 401, "Invalid credentials or expired");
    }

    if (ep === "player") {
      const action = String(q.action || "");
      const channels = (await listChannels()).filter((c) => c.status !== "inactive");
      const liveCategories = categoryData(channels, "1");
      if (action === "get_live_categories") return sendJson(res, 200, liveCategories);
      if (action === "get_live_streams") {
        let list = channels;
        if (q.category_id) list = list.filter((c, i) => categoryIdFor(c, liveCategories, "1", i) === String(q.category_id));
        return sendJson(res, 200, list.map((c) => liveStream(c, channels.indexOf(c), liveCategories)));
      }
      if (action === "get_vod_categories") return sendJson(res, 200, categoryData(await listMovies(), "10"));
      if (action === "get_vod_streams") {
        const movies = await listMovies();
        const categories = categoryData(movies, "10");
        let list = movies;
        if (q.category_id) list = list.filter((m, i) => categoryIdFor(m, categories, "10", i) === String(q.category_id));
        return sendJson(res, 200, list.map((m) => movieStream(m, movies.indexOf(m), categories)));
      }
      if (action === "get_series_categories") return sendJson(res, 200, categoryData(await listSeries(), "20"));
      if (action === "get_series") {
        const series = await listSeries();
        const categories = categoryData(series, "20");
        let list = series;
        if (q.category_id) list = list.filter((s, i) => categoryIdFor(s, categories, "20", i) === String(q.category_id));
        return sendJson(res, 200, list.map((s) => seriesStream(s, series.indexOf(s), categories)));
      }
      if (action === "get_vod_info") {
        const movies = await listMovies();
        const categories = categoryData(movies, "10");
        const index = movies.findIndex((m) => String(m.streamId) === String(q.vod_id) || String(m.id) === String(q.vod_id));
        if (index < 0) return sendJson(res, 404, { error: "VOD not found" });
        const m = movies[index];
        const data = movieStream(m, index, categories);
        return sendJson(res, 200, {
          info: {
            kinopoisk_url: "", tmdb_id: "", name: data.name, o_name: data.name,
            cover_big: m.backdrop || m.poster || "", movie_image: m.poster || "",
            release_date: m.year || "", episode_run_time: m.runtime || "",
            youtube_trailer: "", director: m.director || "", actors: m.cast || "",
            cast: m.cast || "", description: m.plot || "", plot: m.plot || "",
            age: "", mpaa_rating: "", rating_count_kinopoisk: 0, country: m.country || "",
            genre: data.genre, backdrop_path: m.backdrop ? [m.backdrop] : [],
            duration_secs: 0, duration: m.runtime || "", rating: data.rating
          },
          movie_data: data
        });
      }
      if (action === "get_series_info") {
        const all = await listSeries();
        const s = all.find((item) => String(item.seriesId) === String(q.series_id) || String(item.id) === String(q.series_id));
        if (!s) return sendJson(res, 404, { error: "Series not found" });
        const episodes = {};
        const seasonNumbers = new Set();
        for (const ep of asArray(s.episodes)) {
          const season = String(Number(ep.season) || 1);
          seasonNumbers.add(season);
          (episodes[season] ||= []).push({
            id: String(ep.id), episode_num: Number(ep.episode) || 1,
            title: ep.title || `Episode ${ep.episode}`, container_extension: extension(ep.streamUrl),
            info: { plot: ep.plot || "", duration: ep.duration || s.runtime || "", movie_image: s.poster || "", rating: s.imdbRating || "0" },
            custom_sid: "", added: "0", season: Number(season), direct_source: "", stream_available: ep.streamUrl ? 1 : 0
          });
        }
        return sendJson(res, 200, {
          seasons: [...seasonNumbers].sort((a, b) => Number(a) - Number(b)).map((n) => ({ air_date: "", episode_count: episodes[n].length, id: Number(n), name: `Season ${n}`, overview: "", season_number: Number(n), cover: s.poster || "", cover_big: s.backdrop || s.poster || "" })),
          info: {
            name: s.title, title: s.title, cover: s.poster || "", plot: s.plot || "", cast: s.cast || "",
            director: s.director || "", genre: asArray(s.genres).join(", "), release_date: s.year || "",
            last_modified: "0", rating: s.imdbRating || "0", rating_5based: (Number(s.imdbRating) || 0) / 2,
            backdrop_path: s.backdrop ? [s.backdrop] : [], youtube_trailer: "", episode_run_time: s.runtime || "", category_id: String(s.categoryId || "")
          },
          episodes
        });
      }
      if (action === "get_short_epg" || action === "get_simple_data_table") {
        const channel = channels.find((c) => String(c.streamId) === String(q.stream_id) || String(c.id) === String(q.stream_id));
        if (!channel) return sendJson(res, 404, { error: "Channel not found" });
        const listings = await getShortEpg(channel, { limit: Number(q.limit) || 10 });
        return sendJson(res, 200, { epg_listings: listings.map((programme, index) => epgListing(programme, channel, index)) });
      }
      if (action) return sendJson(res, 400, { error: `Unsupported Xtream action: ${action}` });

      const server = new URL(base);
      const serverPort = server.port || (server.protocol === "https:" ? "443" : "80");
      return sendJson(res, 200, {
        user_info: {
          auth: 1, status: "Active", username: acc.username, password: acc.password,
          message: "Welcome to Mizanora IPTV", exp_date: String(acc.expDate || ""),
          is_trial: acc.planId === "trial-1d" ? "1" : "0",
          active_cons: "0", created_at: acc.createdAt ? String(Math.floor(new Date(acc.createdAt).getTime() / 1000) || 0) : "0",
          max_connections: String(acc.maxConnections || 1), allowed_output_formats: ["m3u8"]
        },
        server_info: {
          url: server.hostname, xui: true, version: "Mizanora-5.0", revision: 5,
          url_without_port: server.hostname, port: serverPort,
          https_port: server.protocol === "https:" ? serverPort : "443", server_protocol: server.protocol.replace(":", ""), rtmp_port: "",
          timezone: "Asia/Karachi", timestamp_now: nowTs(), time_now: new Date().toISOString()
        }
      });
    }

    if (ep === "get") {
      const channels = (await listChannels()).filter((c) => c.status !== "inactive");
      const includeVod = String(q.type || "").includes("plus");
      const movies = includeVod ? (await listMovies()).filter((m) => m.streamUrl) : [];
      const series = includeVod ? await listSeries() : [];
      let out = `#EXTM3U x-tvg-url="${m3uAttr(`${base}/xmltv.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`)}"\n`;
      for (const [i, ch] of channels.entries()) {
        const id = Number(ch.streamId) || i + 1;
        out += `#EXTINF:-1 tvg-id="${m3uAttr(ch.epgId || ch.id || id)}" tvg-name="${m3uAttr(ch.name)}" tvg-logo="${m3uAttr(ch.logo || "")}" group-title="${m3uAttr(ch.category || "General")}",${String(ch.name).replace(/[\r\n]/g, " ")}\n`;
        out += `${base}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${id}.m3u8\n`;
      }
      for (const [i, movie] of movies.entries()) {
        const id = Number(movie.streamId) || 5001 + i;
        const ext = extension(movie.streamUrl);
        out += `#EXTINF:-1 tvg-id="${m3uAttr(movie.id || id)}" tvg-name="${m3uAttr(movie.title)}" tvg-logo="${m3uAttr(movie.poster || "")}" group-title="${m3uAttr(movie.category || "Movies")}",${String(movie.title).replace(/[\r\n]/g, " ")}\n`;
        out += `${base}/movie/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${id}.${ext}\n`;
      }
      for (const s of series) {
        for (const ep of asArray(s.episodes).filter((item) => item.streamUrl)) {
          const sid = Number(s.seriesId) || s.id;
          const ext = extension(ep.streamUrl);
          out += `#EXTINF:-1 tvg-id="${m3uAttr(ep.id)}" tvg-name="${m3uAttr(ep.title)}" tvg-logo="${m3uAttr(s.poster || "")}" group-title="${m3uAttr(s.category || "Series")}",${String(ep.title).replace(/[\r\n]/g, " ")}\n`;
          out += `${base}/series/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${sid}/${ep.id}.${ext}\n`;
        }
      }
      return sendText(res, 200, out, "application/vnd.apple.mpegurl; charset=utf-8", { "Content-Disposition": 'attachment; filename="mizanora.m3u"' });
    }

    if (ep === "xmltv") {
      const channels = (await listChannels()).filter((c) => c.status !== "inactive");
      const epg = await getEpgData();
      const now = Date.now();
      const programmes = epg.programmes.filter((p) => Number(p.stop) >= now - 6 * 3600_000 && Number(p.start) <= now + 14 * 86400_000).slice(0, 12000);
      const declared = new Set();
      const aliases = new Map();
      const names = new Map();
      const sourceChannels = new Map(epg.channels.map((channel) => [String(channel.id), channel]));
      const normalized = (value) => String(value || "").trim().toLowerCase();
      for (const [index, channel] of channels.entries()) {
        const id = String(channel.epgId || channel.id || channel.streamId || index + 1);
        declared.add(id);
        for (const alias of [channel.epgId, channel.id, channel.streamId]) if (alias !== undefined && alias !== null && String(alias)) aliases.set(String(alias), id);
        if (normalized(channel.name) && !names.has(normalized(channel.name))) names.set(normalized(channel.name), id);
      }
      // XMLTV display-name matching is a fallback only; explicit IDs always win.
      for (const source of epg.channels) {
        const mapped = names.get(normalized(source.name));
        if (mapped && !aliases.has(String(source.id))) aliases.set(String(source.id), mapped);
      }
      const mappedProgrammes = programmes.map((programme) => ({ ...programme, channelId: aliases.get(String(programme.channelId)) || String(programme.channelId) }));
      let out = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Mizanora IPTV">\n';
      const emitted = new Set();
      for (const [index, channel] of channels.entries()) {
        const id = String(channel.epgId || channel.id || channel.streamId || index + 1);
        if (emitted.has(id)) continue;
        emitted.add(id);
        out += `<channel id="${xml(id)}"><display-name>${xml(channel.name)}</display-name>${channel.logo ? `<icon src="${xml(channel.logo)}"/>` : ""}</channel>\n`;
      }
      // Preserve valid source-only declarations instead of emitting orphan programmes.
      for (const programme of mappedProgrammes) {
        if (declared.has(programme.channelId)) continue;
        declared.add(programme.channelId);
        const source = sourceChannels.get(String(programme.channelId));
        out += `<channel id="${xml(programme.channelId)}"><display-name>${xml(source?.name || programme.channelId)}</display-name>${source?.icon ? `<icon src="${xml(source.icon)}"/>` : ""}</channel>\n`;
      }
      for (const programme of mappedProgrammes) out += programmeXml(programme, xml);
      out += "</tv>";
      return sendText(res, 200, out, "application/xml; charset=utf-8");
    }

    if (ep === "file") {
      const kind = String(q.kind || "live");
      const fileUser = decodeURIComponent(fileParts[0] || "");
      const filePass = decodeURIComponent(fileParts[1] || "");
      if (fileUser.toLowerCase() !== String(acc.username).toLowerCase() || filePass !== p) return sendText(res, 403, "Access denied");
      const file = fileParts.slice(2).join("/") || "index.m3u8";
      const signed = signStreamFor(base, acc.username, file, kind);
      res.writeHead(302, { Location: signed.url, "Cache-Control": "no-store", ...corsHeaders() });
      return res.end();
    }

    return sendJson(res, 400, { ok: false, error: "Unknown xtream endpoint" });
  } catch (error) {
    console.error("xtream error:", error);
    return sendJson(res, error.status || 500, { ok: false, error: error.message || "Xtream request failed" });
  }
}
