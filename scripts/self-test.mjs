/** Mizanora IPTV integration suite — isolated offline RTDB mirror, real HTTP. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR = path.join(os.tmpdir(), `mizanora-test-${process.pid}-${Date.now()}.json`);
process.env.MZ_RTDB_MIRROR = MIRROR;
process.env.MZ_RTDB_OFFLINE = "1";
process.env.VERCEL = "";
process.env.MZ_REQUIRE_PERSISTENCE = "";
const { createAppServer } = await import("./dev-server.mjs");

let passed = 0, failed = 0;
function check(name, condition, extra = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`, extra || ""); }
}

console.log("\n📁 Structure");
for (const file of [
  "public/index.html", "public/admin.html", "public/reseller.html", "public/developers.html", "public/embed.html", "public/embed.js",
  "public/assets/js/reseller.js", "public/assets/js/guide.js", "docs/VERCEL.md", "docs/M3U-EPG.md", "docs/RESELLER.md",
  "public/assets/css/site.css", "public/assets/css/admin.css", "public/assets/js/site.js",
  "public/assets/js/admin.js", "public/assets/js/firebase-client.js", "public/assets/vendor/firebase-sdk.js", "public/assets/vendor/hls.min.js",
  "api/panel.js", "api/xtream.js", "api/embed.js", "api/portal.js", "api/stream.js",
  "api/_lib/util.js", "api/_lib/rtdb.js", "api/_lib/auth.js", "api/_lib/store.js", "api/_lib/m3u.js", "api/_lib/epg.js", "api/_lib/remote.js",
  "api/_handlers/panel.js", "api/_handlers/xtream.js", "api/_handlers/embed.js", "api/_handlers/portal.js", "api/_handlers/stream.js",
  "vercel.json", "package.json", "firebase/database.rules.json", "scripts/dev-server.mjs"
]) check(`exists ${file}`, fs.existsSync(path.join(ROOT, file)));
const firebaseClient = fs.readFileSync(path.join(ROOT, "public/assets/js/firebase-client.js"), "utf8");
check("Firebase web config present", firebaseClient.includes("mizanoranet-default-rtdb.firebaseio.com") && firebaseClient.includes("mizanoranet.web.app") === false && firebaseClient.includes("appId"));
const rtdbSource = fs.readFileSync(path.join(ROOT, "api/_lib/rtdb.js"), "utf8");
check("server has durable service-account OAuth support", rtdbSource.includes("FIREBASE_SERVICE_ACCOUNT_JSON") && rtdbSource.includes("access_token") && rtdbSource.includes("RSA-SHA256"));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase/database.rules.json"), "utf8"));
check("Firebase rules lock panel to owner email", JSON.stringify(rules).includes("muaaziqbal.vip@gmail.com"));
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const sources = (vercel.rewrites || []).map((r) => r.source);
for (const route of ["/player_api.php", "/get.php", "/xmltv.php", "/live/(.*)", "/movie/(.*)", "/series/(.*)", "/portal.php", "/stalker_portal/(.*)", "/c/(.*)", "/s/(.*)", "/admin", "/reseller", "/developers", "/guide"]) check(`vercel rewrite ${route}`, sources.includes(route));
check("COOP allows Firebase popup auth", (vercel.headers || []).filter((h) => ["/", "/admin", "/admin.html"].includes(h.source)).every((h) => h.headers.some((x) => x.key === "Cross-Origin-Opener-Policy" && x.value === "same-origin-allow-popups")));
const adminHtml = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin.js"), "utf8");
check("admin lock controls present", ["adminLock", "lockGoogleBtn", "lockGoogleRedirectBtn", "lockPinIn", "lockPinBtn", "lockErr"].every((id) => adminHtml.includes(`id="${id}"`)));
check("admin has real CRUD and dialog bindings", ["admin/channel-create", "admin/playlist-save", "admin/movie-update", "data-ch-edit", "openForm"].every((text) => adminJs.includes(text)));
check("14 tabs ↔ views consistent", Object.values({ dashboard:"viewDashboard", channels:"viewChannels", playlists:"viewPlaylists", epg:"viewEpg", xtream:"viewXtream", movies:"viewMovies", series:"viewSeries", analytics:"viewAnalytics", users:"viewUsers", settings:"viewSettings", resellers:"viewResellers", orders:"viewOrders", stalker:"viewStalker", apikeys:"viewApiKeys" }).every((id) => adminHtml.includes(`id="${id}"`)));
const { parseBody } = await import("../api/_lib/util.js");
check("Vercel pre-parsed JSON bodies are accepted", (await parseBody({ body: { action: "admin/me" } })).action === "admin/me");
const { parseM3U } = await import("../api/_lib/m3u.js");
const { parseXmlTv, formatXmlTvDate } = await import("../api/_lib/epg.js");
const { remoteImportInternals } = await import("../api/_lib/remote.js");
check("remote import rejects private and mapped IP forms", ["127.0.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "ff02::1"].every((ip) => remoteImportInternals.privateAddress(ip)) && !remoteImportInternals.privateAddress("8.8.8.8"));
const parsedSample = parseM3U('#EXTM3U x-tvg-url="https://example.com/guide.xml"\n#EXTINF:-1 tvg-id="demo.one" tvg-logo="logo.png" group-title="News",Demo, One\nvideo.m3u8\n', { baseUrl: "https://example.com/list/main.m3u" });
check("M3U parser handles attributes, commas and relative URLs", parsedSample.channels[0]?.name === "Demo, One" && parsedSample.channels[0]?.url === "https://example.com/list/video.m3u8" && parsedSample.epgUrls.length === 1);
const parsedXml = parseXmlTv('<tv><channel id="demo.one"><display-name>Demo &amp; One</display-name></channel><programme channel="demo.one" start="20261102000000 +0000" stop="20261102010000 +0000"><title>News &amp; Views</title></programme></tv>');
check("XMLTV parser decodes channels, programmes and entities", parsedXml.channels[0]?.name === "Demo & One" && parsedXml.programmes[0]?.title === "News & Views" && formatXmlTvDate(parsedXml.programmes[0].start) === "20261102000000 +0000");
const localPlaylists = fs.readdirSync(path.join(ROOT, "public/media"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(ROOT, "public/media", entry.name, "index.m3u8")).filter((file) => fs.existsSync(file));
check("bundled HLS playlists reference existing media segments", localPlaylists.length >= 5 && localPlaylists.every((file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.startsWith("seg")).every((line) => fs.existsSync(path.join(path.dirname(file), line.trim())))));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
const panelData = fs.readFileSync(path.join(ROOT, "data/panel.js"), "utf8");
check("v5 version metadata and clean page routes are present", pkg.version === "5.1.0" && lock.version === "5.1.0" && lock.packages?.[""]?.version === "5.1.0" && panelData.includes('version: "5.1.0"') && ["/reseller", "/developers", "/guide"].every((route) => sources.includes(route)));

console.log("\n🌐 Real HTTP integration");
const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let remoteBase = "";
const remoteServer = http.createServer((req, res) => {
  if (req.url === "/playlist.m3u") {
    const body = `#EXTM3U x-tvg-url="${remoteBase}/guide.xml"\n#EXTINF:-1 tvg-id="mz.test.one" tvg-logo="/logo.png" group-title="Test News",MZ Test, One\n${base}/media/demo-live/index.m3u8\n#EXTINF:-1 tvg-id="mz.test.two" group-title="Test Promo",MZ Test Two\n${base}/media/welcome/index.m3u8\n#EXTINF:-1 tvg-id="bad",Invalid\njavascript:alert(1)\n`;
    res.writeHead(200, { "Content-Type": "audio/mpegurl" }); return res.end(body);
  }
  if (req.url === "/hls/master.m3u8?token=test") {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" });
    return res.end("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant/index.m3u8\n");
  }
  if (req.url === "/hls/variant/index.m3u8") {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" });
    return res.end("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n");
  }
  if (req.url === "/hls/variant/segment.ts") {
    res.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
    return res.end("test transport stream");
  }
  if (req.url === "/guide.xml") {
    const now = Date.now();
    const body = `<tv><channel id="mz.test.one"><display-name>MZ Test, One</display-name></channel><programme channel="mz.test.one" start="${formatXmlTvDate(now - 1800000)}" stop="${formatXmlTvDate(now + 1800000)}"><title>Live Test &amp; News</title><desc>Current programme</desc><category>News</category></programme><programme channel="mz.test.one" start="${formatXmlTvDate(now + 1800000)}" stop="${formatXmlTvDate(now + 5400000)}"><title>Next Test Show</title></programme></tv>`;
    res.writeHead(200, { "Content-Type": "application/xml" }); return res.end(body);
  }
  res.writeHead(404); res.end("not found");
});
await new Promise((resolve) => remoteServer.listen(0, "127.0.0.1", resolve));
remoteBase = `http://127.0.0.1:${remoteServer.address().port}`;
async function request(route, options = {}) {
  const response = await fetch(new URL(route, base), options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, text, headers: response.headers };
}
const post = (route, value, headers = {}) => request(route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
const panelPost = (value, headers = {}) => post("/api/panel", value, headers);
let r;
try {
  r = await request("/"); check("landing loads with COOP", r.status === 200 && r.text.includes("Mizanora IPTV") && r.headers.get("cross-origin-opener-policy")?.includes("same-origin-allow-popups"));
  r = await request("/admin"); check("admin lock loads", r.status === 200 && r.text.includes('id="adminLock"'));
  r = await request("/reseller"); check("reseller workspace route loads", r.status === 200 && r.text.includes("resellerLoginForm") && r.text.includes("clientCreateForm"));
  r = await request("/developers"); check("developer guide and embed builder load", r.status === 200 && r.text.includes("embedCode") && r.text.includes("resellerExample"));
  r = await request("/media/welcome/index.m3u8"); check("welcome promo HLS references corrected segments", r.status === 200 && r.text.includes("seg0.m2ts"));
  r = await request("/media/welcome/seg0.m2ts"); check("welcome promo first segment is actually available", r.status === 200 && r.headers.get("content-type") === "video/mp2t");
  r = await request("/media/welcome/video.mp4", { headers: { Range: "bytes=0-31" } }); check("configurable intro MP4 supports byte-range playback", r.status === 206 && r.headers.get("content-type") === "video/mp4" && r.headers.get("content-range")?.startsWith("bytes 0-31/"));
  r = await request("/embed.js"); check("embed widget loads", r.status === 200 && r.text.includes("data-mizanora-embed"));
  r = await request("/api/embed?action=help"); check("embed help is not a dead link", r.status === 200 && r.body.ok && r.body.actions);
  r = await request("/api/embed?action=health"); check("health reports storage diagnostics", r.status === 200 && r.body.ok && r.body.storage && typeof r.body.storage.durableServerWrites === "boolean");
  r = await request("/api/panel?action=config"); check("public config and endpoints", r.status === 200 && r.body.brand === "Mizanora IPTV" && r.body.endpoints.magPortal.endsWith("/portal.php") && r.body.version === "5.1.0");
  r = await request("/api/embed?action=config"); check("public intro, recharge and developer settings are available", r.status === 200 && r.body.experience?.intro?.url === "/media/welcome/video.mp4" && r.body.links?.resellerPanel.endsWith("/reseller") && r.body.links?.developers.endsWith("/developers"));
  r = await request("/api/embed?action=channels"); check("default live catalog and welcome promo are available", r.status === 200 && r.body.count >= 18 && r.body.channels.some((c) => c.id === "ch_mz_promo" && /Welcome/i.test(c.name)));
  const firstChannel = r.body.channels[0];
  const proChannel = r.body.channels.find((c) => c.tier === "pro");
  r = await request("/api/embed?action=movies&limit=5"); check("built-in movie metadata fallback works", r.status === 200 && r.body.total > 1000 && r.body.movies.length === 5 && r.body.movies[0].rating);
  const firstMovie = r.body.movies[0];
  r = await request("/api/embed?action=series&limit=3"); check("built-in series metadata fallback works", r.status === 200 && r.body.total > 400 && r.body.series.length === 3 && r.body.series[0].episodeCount > 0);
  const firstSeries = r.body.series[0];
  r = await request("/api/embed?action=movies&limit=5&q=Maula"); check("catalog server search works", r.status === 200 && r.body.total >= 1 && r.body.movies.some((m) => /Maula/i.test(m.title)));
  r = await request(`/api/embed?action=stream&id=${firstChannel.id}`); check("free preview issues a signed token", r.status === 200 && r.body.url?.includes("/s/"));
  const publicPreview = r.body.url;
  r = await request(new URL(publicPreview).pathname, { redirect: "manual" }); check("public preview redirects to the actual source", r.status === 302 && !!r.headers.get("location"));
  r = await request("/api/panel?action=admin/me", { headers: { "x-admin-token": "mzp_" + new URL(publicPreview).pathname.split("/s/")[1] } }); check("stream token cannot be reused as an admin PIN session", r.status === 401);
  r = await request(`/api/embed?action=stream&id=${proChannel.id}`); check("PRO preview cannot bypass subscription", r.status === 403);
  r = await request("/media/demo-live/seg0.m2ts", { headers: { Range: "bytes=0-99" } }); check("video byte range returns 206 + correct MIME", r.status === 206 && r.headers.get("content-range")?.startsWith("bytes 0-99/") && r.headers.get("content-type") === "video/mp2t");

  console.log("\n⚡ Trial + Xtream protocol");
  r = await panelPost({ action: "trial", email: "not-an-email", deviceId: "invalid-email-device" }); check("trial rejects malformed email even with device ID", r.status === 409);
  const trialEmail = `selftest${Date.now()}@test.com`;
  r = await panelPost({ action: "trial", email: trialEmail, deviceId: "trial-device" }); check("trial creates credentials", r.status === 201 && r.body.client?.username && r.body.links?.m3u);
  check("generated links preserve actual HTTP origin and port", new URL(r.body.links.m3u).origin === base && new URL(r.body.links.playerApi).origin === base);
  const U = r.body.client.username, P = r.body.client.password;
  r = await panelPost({ action: "trial", email: trialEmail, deviceId: "another-device" }); check("duplicate email trial is blocked", r.status === 409);
  r = await request(`/player_api.php?username=${U}&password=${P}`); check("Xtream login returns active user_info", r.status === 200 && r.body.user_info?.auth === 1 && r.body.server_info?.timezone === "Asia/Karachi");
  r = await request(`/player_api.php?username=${U}&password=wrong`); check("Xtream bad password auth=0", r.body.user_info?.auth === 0);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_live_categories`); check("get_live_categories returns real categories", r.status === 200 && Array.isArray(r.body) && r.body.length >= 5);
  const liveCategories = r.body;
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_live_streams`); check("get_live_streams returns playable IDs and valid category mapping", Array.isArray(r.body) && r.body.length >= 18 && r.body.every((c) => liveCategories.some((cat) => cat.category_id === c.category_id)));
  const liveStreams = r.body;
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_vod_categories`); check("get_vod_categories works", Array.isArray(r.body) && r.body.length > 3);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_vod_streams`); check("get_vod_streams works with playback availability", Array.isArray(r.body) && r.body.length > 1000 && r.body[0].stream_available === 0);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_vod_info&vod_id=${firstMovie.streamId}`); check("get_vod_info returns info + movie_data", r.status === 200 && r.body.info && r.body.movie_data?.stream_id === firstMovie.streamId);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_series_categories`); check("get_series_categories works", Array.isArray(r.body) && r.body.length > 3);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_series`); check("get_series works", Array.isArray(r.body) && r.body.length > 400);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_series_info&series_id=${firstSeries.streamId}`); check("get_series_info returns seasons + episodes", r.status === 200 && r.body.seasons?.length && Object.keys(r.body.episodes || {}).length > 0);
  r = await request(`/get.php?username=${U}&password=${P}&type=m3u_plus&output=m3u8`); check("M3U uses actual live stream IDs", r.status === 200 && r.text.startsWith("#EXTM3U") && r.text.includes(`/live/${U}/${P}/${liveStreams[0].stream_id}.m3u8`));
  check("M3U linked XMLTV URL preserves query authentication", r.text.split("\n")[0].includes(`xmltv.php?username=${U}&password=${P}`) && !r.text.split("\n")[0].includes("&amp;"));
  r = await request(`/xmltv.php?username=${U}&password=${P}`); check("XMLTV contains escaped channels", r.status === 200 && r.text.includes("<tv") && r.text.includes("<display-name>"));
  r = await request(`/live/${U}/${P}/${liveStreams[0].stream_id}.m3u8`, { redirect: "manual" }); check("live URL redirects to signed /s/", r.status === 302 && r.headers.get("location")?.includes("/s/"));
  const signedPath = new URL(r.headers.get("location")).pathname;
  r = await request(signedPath, { redirect: "manual" }); check("signed live URL redirects to the real source without nesting playlists", r.status === 302 && !!r.headers.get("location"));
  r = await request(`/live/${U}/${P}/does-not-exist.m3u8`, { redirect: "manual" }); const missingPath = new URL(r.headers.get("location")).pathname;
  r = await request(missingPath); check("unknown stream is 404, never random channel fallback", r.status === 404);
  r = await request("/s/tampered.token"); check("tampered signed token is rejected", r.status === 403);
  r = await request(`/api/panel?action=resolve&username=${U}`); check("username alone cannot disclose credentials", r.status === 401);
  r = await request(`/api/panel?action=resolve&username=${U}&password=${encodeURIComponent(P)}`); check("correct credentials resolve account links", r.status === 200 && r.body.links?.m3u.includes(P));
  r = await panelPost({ action: "track", sessionId: "selftest_session", event: "stream_play", route: "/channel/test" }); check("analytics event accepted", r.status === 202 && r.body.ok);

  // Exercise the actual Xtream -> signed URL -> provider redirect chain, including
  // master playlists with relative variants and segments and colliding IDs.
  const { rtdbGet, rtdbSet } = await import("../api/_lib/rtdb.js");
  const originalChannels = await rtdbGet("channels");
  await rtdbSet("channels", [
    { id: "inactive", streamId: 99, name: "Inactive", status: "inactive", url: `${remoteBase}/hls/master.m3u8?token=test` },
    { id: "explicit", streamId: 2, name: "Master", status: "active", url: `${remoteBase}/hls/master.m3u8?token=test` },
    { id: "other", streamId: 42, name: "Other", status: "active", url: `${base}/media/welcome/index.m3u8` },
    { id: "legacy", name: "Legacy", status: "active", url: `${base}/media/demo-live/index.m3u8` }
  ]);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_live_streams`);
  check("Xtream listing uses active IDs and legacy positions", r.body.map((c) => c.stream_id).join(",") === "2,42,3");
  const masterResponse = await fetch(`${base}/live/${U}/${P}/2.m3u8`);
  const master = await masterResponse.text();
  check("Xtream follows the correct channel to the original HLS master", masterResponse.status === 200 && masterResponse.url === `${remoteBase}/hls/master.m3u8?token=test` && master.includes("variant/index.m3u8"));
  const variantResponse = await fetch(new URL("variant/index.m3u8", masterResponse.url));
  const variant = await variantResponse.text();
  const segmentResponse = await fetch(new URL("segment.ts", variantResponse.url));
  check("provider-relative variant and segment remain playable", variant.includes("segment.ts") && segmentResponse.ok && await segmentResponse.text() === "test transport stream");
  r = await request(`/live/${U}/${P}/3.m3u8`);
  check("legacy positional stream ID matches active Xtream listing", r.status === 200 && r.text.includes("seg0"));
  r = await request(`/live/${U}/wrong/2.m3u8`); check("live stream rejects incorrect password", r.status === 401);
  r = await request(`/live/${U}/${P}/99.m3u8`); check("inactive channel cannot play", r.status === 404);
  await rtdbSet("channels", originalChannels);

  console.log("\n🛡️ Owner admin + CRUD");
  r = await request("/api/panel?action=admin/me"); check("admin requires auth", r.status === 401);
  r = await panelPost({ action: "admin/pin-login", pin: "wrong" }); check("wrong owner PIN rejected", r.status === 401);
  r = await panelPost({ action: "admin/pin-login", pin: "03062015326" }); check("owner PIN issues mzp_ session", r.status === 200 && r.body.token?.startsWith("mzp_"));
  const pinHeaders = { "x-admin-token": r.body.token };
  r = await request("/api/panel?action=admin/me", { headers: pinHeaders }); check("PIN session authenticates owner", r.status === 200 && r.body.admin?.via === "pin");
  r = await panelPost({ action: "admin/api-key-create", label: "selftest" }, pinHeaders); check("admin API key created", r.status === 201 && r.body.apiKey?.startsWith("mzk_"));
  const MZK = r.body.apiKey, keyId = r.body.id;
  const keyHeaders = { "x-api-key": MZK };
  r = await request("/api/panel?action=admin/api-keys", { headers: keyHeaders }); check("key list has public ID but no secret hash", r.status === 200 && r.body.keys.some((k) => k.id === keyId) && !JSON.stringify(r.body).includes('"hash"'));

  console.log("\n📥 M3U + XMLTV imports");
  r = await panelPost({ action: "admin/channels/import", url: `${remoteBase}/playlist.m3u`, name: "Selftest Remote", defaultTier: "pro", importEpg: true }, keyHeaders); check("remote M3U imports channels and linked XMLTV", r.status === 200 && r.body.created === 2 && r.body.updated === 0 && r.body.skipped === 1 && r.body.epgImports?.[0]?.programmes === 2);
  r = await panelPost({ action: "admin/channels/import", url: `${remoteBase}/playlist.m3u`, name: "Selftest Remote", defaultTier: "free", importEpg: false }, keyHeaders); check("same M3U re-import updates without duplicates", r.status === 200 && r.body.created === 0 && r.body.updated === 2 && r.body.total === 20);
  const largeBodyM3u = `#${"x".repeat(1_100_000)}\n#EXTM3U\n#EXTINF:-1 tvg-id="mz.large.body",Large Body Channel\n${base}/media/demo-live/index.m3u8\n`;
  r = await panelPost({ action: "admin/channels/import", content: largeBodyM3u, name: "Large Body Import" }, keyHeaders); check("body-only action accepts imports larger than the old 1 MB envelope", largeBodyM3u.length > 1_000_000 && r.status === 200 && r.body.created === 1);
  r = await request("/api/embed?action=channels"); const importedChannel = r.body.channels.find((c) => c.id === "ch_mz_test_one"); check("imported channel metadata and PRO default are public-safe", !!importedChannel && importedChannel.name === "MZ Test, One" && importedChannel.tier === "pro" && importedChannel.epgId === "mz.test.one" && !("url" in importedChannel));
  r = await request("/api/embed?action=guide&channel=ch_mz_test_one"); check("public guide returns imported now and next programmes", r.status === 200 && r.body.guide?.[0]?.now?.title === "Live Test & News" && r.body.guide?.[0]?.next?.title === "Next Test Show");
  r = await request("/api/embed?action=guide&limit=1"); check("guide pagination limits work without losing total count", r.status === 200 && r.body.count === 1 && r.body.guide.length === 1 && r.body.total >= 20);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_live_categories`); const importedCategory = r.body.find((category) => category.category_name === "Test News"); check("imported categories receive a real numeric Xtream ID", !!importedCategory && /^\d+$/.test(importedCategory.category_id) && r.body.filter((category) => category.category_name === "Test News").length === 1);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_live_streams&category_id=${encodeURIComponent(importedCategory?.category_id || "")}`); check("Xtream category filter returns only matching imported channels", r.status === 200 && r.body.length === 1 && r.body[0]?.stream_id === importedChannel?.streamId && r.body.every((stream) => stream.category_id === importedCategory?.category_id && stream.category_ids[0] === Number(importedCategory?.category_id)));
  r = await request("/api/panel?action=admin/epg-sources", { headers: keyHeaders }); const epgSourceId = r.body.sources?.[0]?.id || ""; check("admin EPG source list shows counts", r.status === 200 && !!epgSourceId && r.body.sources[0].programmeCount === 2);
  r = await request(`/player_api.php?username=${U}&password=${P}&action=get_short_epg&stream_id=${importedChannel?.streamId || 0}&limit=4`); check("Xtream short EPG returns current programme", r.status === 200 && Buffer.from(r.body.epg_listings?.[0]?.title || "", "base64").toString("utf8") === "Live Test & News");
  r = await panelPost({ action: "admin/channel-update", id: "ch_mz_test_one", patch: { epgId: "" } }, keyHeaders); check("channel can fall back to XMLTV display-name mapping", r.status === 200 && r.body.channel.epgId === "");
  r = await request(`/xmltv.php?username=${U}&password=${P}`); check("authenticated XMLTV includes mapped programme entries", r.status === 200 && r.text.includes('<channel id="ch_mz_test_one">') && r.text.includes('channel="ch_mz_test_one"') && r.text.includes("Live Test &amp; News"));
  if (epgSourceId) {
    r = await panelPost({ action: "admin/epg-refresh", id: epgSourceId }, keyHeaders); check("remote EPG source can be refreshed", r.status === 200 && r.body.programmes === 2);
    r = await panelPost({ action: "admin/epg-delete", id: epgSourceId }, keyHeaders); check("EPG source deletion succeeds", r.status === 200 && r.body.ok);
  }

  r = await panelPost({ action: "admin/channel-create", name: "Selftest Channel", url: "/media/demo-live/index.m3u8", category: "Test", tier: "free" }, keyHeaders); check("channel create works", r.status === 201 && r.body.channel?.id);
  const channelId = r.body.channel.id;
  r = await panelPost({ action: "admin/channel-update", id: channelId, patch: { name: "Selftest Channel Updated", url: "/media/demo-live/index.m3u8", category: "Test", tier: "pro" } }, keyHeaders); check("channel update works", r.status === 200 && r.body.channel?.name.endsWith("Updated") && r.body.channel?.tier === "pro");
  r = await request("/api/embed?action=channels"); check("channel update appears in public API", r.body.channels.some((c) => c.id === channelId && c.name.endsWith("Updated")));
  r = await panelPost({ action: "admin/channel-delete", id: channelId }, keyHeaders); check("channel delete works", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "admin/playlist-save", name: "Selftest Playlist", url: "/media/demo-live/index.m3u8" }, keyHeaders); check("playlist create works", r.status === 200 && r.body.playlist?.id);
  const playlistId = r.body.playlist.id;
  r = await panelPost({ action: "admin/playlist-save", id: playlistId, name: "Selftest Playlist 2", url: "/media/demo-live/index.m3u8" }, keyHeaders); check("playlist edit works", r.body.playlist?.name === "Selftest Playlist 2");
  r = await panelPost({ action: "admin/playlist-delete", id: playlistId }, keyHeaders); check("playlist delete works", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "admin/movie-update", id: firstMovie.id, patch: { streamUrl: "/media/welcome/video.mp4" } }, keyHeaders); check("licensed movie stream URL can be configured", r.status === 200 && r.body.movie?.streamUrl.endsWith(".mp4"));
  r = await request(`/movie/${U}/${P}/${firstMovie.streamId}.mp4`, { redirect: "manual" }); check("movie URL signs configured VOD", r.status === 302 && r.headers.get("location")?.includes("/s/"));
  const movieSigned = new URL(r.headers.get("location")).pathname;
  r = await request(movieSigned, { redirect: "manual" }); check("signed MP4 redirects to actual file, not fake HLS", r.status === 302 && r.headers.get("location")?.endsWith("/media/welcome/video.mp4"));
  const firstEpisode = firstSeries.episodes?.[0];
  r = await panelPost({ action: "admin/series-update", id: firstSeries.id, patch: { episodes: [{ id: firstEpisode.id, streamUrl: "/media/welcome/video.mp4" }] } }, keyHeaders); check("licensed series episode URL can be configured", r.status === 200 && r.body.series?.episodes?.some((ep) => ep.id === firstEpisode.id && ep.streamUrl?.endsWith(".mp4")));
  r = await request(`/series/${U}/${P}/${firstSeries.streamId}/${firstEpisode.id}.mp4`, { redirect: "manual" }); check("series episode URL signs configured playback", r.status === 302 && r.headers.get("location")?.includes("/s/"));
  const seriesSigned = r.headers.get("location");
  r = await request(seriesSigned, { redirect: "manual" }); check("signed episode redirects to actual media file", r.status === 302 && r.headers.get("location")?.endsWith("/media/welcome/video.mp4"));
  r = await panelPost({ action: "admin/xtream/create", username: "selftest_x", name: "Selftest", mac: "00:1A:79:00:00:01", days: 30 }, keyHeaders); check("Xtream create binds MAC", r.status === 200 && r.body.client?.mac === "00:1A:79:00:00:01");
  const XU = r.body.client.username;
  r = await panelPost({ action: "admin/xtream/create", username: "selftest_x", name: "Duplicate" }, keyHeaders); check("duplicate username cannot overwrite client", r.status === 409);
  r = await panelPost({ action: "admin/xtream/create", username: "selftest_mac_clash", mac: "00:1A:79:00:00:01" }, keyHeaders); check("duplicate MAC is rejected centrally", r.status === 409);
  r = await panelPost({ action: "admin/xtream/renew", username: XU, planId: "monthly" }, keyHeaders); check("Xtream renew works", r.status === 200 && r.body.client?.expDate > Date.now() / 1000);
  r = await request("/api/panel?action=admin/stalker/list", { headers: keyHeaders }); check("admin MAG list sees MAC client", r.status === 200 && r.body.clients.some((c) => c.mac === "00:1A:79:00:00:01"));

  console.log("\n🛰️ MAG / Stalker");
  r = await request("/portal.php?action=handshake&mac=00:1A:79:00:00:01"); check("MAG handshake returns token", r.status === 200 && r.body.js?.token);
  const macToken = r.body.js.token;
  r = await request(`/stalker_portal/server/load.php?mac=00:1A:79:00:00:01&token=${macToken}`); check("registered MAG profile is active", r.status === 200 && r.body.js?.mac === "00:1A:79:00:00:01" && r.body.js?.stb?.status === "active");
  r = await request(`/portal.php?action=get_genres&mac=00:1A:79:00:00:01&token=${macToken}`); check("MAG genres available", r.status === 200 && Array.isArray(r.body.js) && r.body.js.length > 3);
  r = await request(`/portal.php?action=get_all_channels&mac=00:1A:79:00:00:01&token=${macToken}`); check("MAG channel list contains authenticated URLs", r.status === 200 && Array.isArray(r.body.js) && r.body.js.length >= 18 && r.body.js[0].cmd.includes("/live/"));
  const magChannel = r.body.js[0];
  r = await request(`/portal.php?action=get_ordered_list&mac=00:1A:79:00:00:01&token=${macToken}&p=1&per_page=5`); check("MAG paginated ordered_list works", r.status === 200 && r.body.js?.data?.length === 5 && r.body.js?.total_items >= 18);
  r = await request(`/portal.php?action=create_link&mac=00:1A:79:00:00:01&token=${macToken}&cmd=${encodeURIComponent(magChannel.cmd)}`); check("MAG create_link returns selected channel", r.status === 200 && r.body.js?.cmd.includes(`/live/${XU}/`));
  r = await request("/portal.php?action=handshake&mac=00:1A:79:FF:FF:FF"); const unknownToken = r.body.js?.token;
  r = await request(`/stalker_portal/server/load.php?mac=00:1A:79:FF:FF:FF&token=${unknownToken}`); check("unknown MAC is blocked", r.status === 403);
  r = await request("/c/portal.php"); check("short MAG landing remains available", r.status === 200 && r.text.includes("MAG Portal"));

  console.log("\n🧾 Orders + lifecycle");
  r = await panelPost({ action: "order", name: "Self Buyer", email: `buyer${Date.now()}@test.com`, whatsapp: "03005550001", planId: "monthly", days: 3650, amount: 0, resellerCode: "HACK" }); check("public order cannot manipulate amount, duration or reseller", r.status === 201 && r.body.order?.amount === 200 && r.body.order?.days === 30 && r.body.order?.resellerCode === "");
  const orderId = r.body.order.id;
  r = await panelPost({ action: "admin/order-review", id: orderId, approve: true }, keyHeaders); check("order approval provisions client", r.status === 200 && r.body.client?.username);
  const orderClient = r.body.client.username;
  r = await panelPost({ action: "admin/order-review", id: orderId, approve: true }, keyHeaders); check("same order cannot be approved twice", r.status === 409);
  r = await request(`/api/panel?action=order-status&id=${orderId}`); check("public order status hides customer PII", r.status === 200 && r.body.order?.status === "approved" && !("email" in r.body.order) && !("whatsapp" in r.body.order));
  r = await request("/api/panel?action=admin/analytics", { headers: keyHeaders }); check("analytics includes real recent session", r.status === 200 && r.body.analytics?.totalSessions >= 1 && r.body.analytics?.recentSessions?.some((s) => s.id === "selftest_session"));
  r = await panelPost({ action: "admin/xtream/suspend", username: XU }, keyHeaders); check("Xtream suspend works", r.status === 200 && r.body.client?.status === "suspended");
  r = await request(`/player_api.php?username=${XU}&password=${encodeURIComponent(r.body.client.password)}`); check("suspended account cannot login", r.body.user_info?.auth === 0);
  r = await request(`/stalker_portal/server/load.php?mac=00:1A:79:00:00:01&token=${macToken}`); check("suspended MAC loses portal access", r.status === 403);
  r = await panelPost({ action: "admin/xtream/activate", username: XU }, keyHeaders); check("Xtream reactivation works", r.status === 200 && r.body.client?.status === "active");
  r = await panelPost({ action: "admin/api-key-revoke", id: keyId }, keyHeaders); check("API key revoke works by panel-visible ID", r.status === 200 && r.body.ok);
  r = await request("/api/panel?action=admin/me", { headers: keyHeaders }); check("revoked key stops working immediately", r.status === 401);

  console.log("\n🏪 Reseller lifecycle");
  r = await panelPost({ action: "reseller/register", name: "Self Dealer", email: `dealer${Date.now()}@test.com`, password: "pass1234", whatsapp: "03005550001" }); check("reseller registration issues mzr_ key", r.status === 201 && r.body.reseller?.apiKey?.startsWith("mzr_"));
  const resellerCode = r.body.reseller.code;
  const resellerKey = r.body.reseller.apiKey;
  const resellerHeaders = { "x-api-key": resellerKey };
  r = await panelPost({ action: "reseller/client-create", name: "MAG Client", mac: "00:1A:79:AB:CD:01", days: 9999, startTs: 3000000000, collectAmount: 300 }, resellerHeaders); check("reseller creates MAC client + links and cannot override plan days", r.status === 200 && r.body.links?.m3u && r.body.stalker?.portalUrl.endsWith("/portal.php") && r.body.client.expDate - r.body.client.startDate === 30 * 86400 && Math.abs(r.body.client.startDate - Date.now() / 1000) < 60);
  const clientUsername = r.body.client.username, initialExpiry = r.body.client.expDate;
  r = await panelPost({ action: "recharge/contact", username: clientUsername }); check("public recharge finds the correct reseller contact", r.status === 200 && r.body.resellerName === "Self Dealer" && r.body.whatsapp.includes("03005550001"));
  r = await panelPost({ action: "reseller/credentials", username: clientUsername }, resellerHeaders); check("initial payment does not double-extend expiry", r.status === 200 && r.body.client?.expDate === initialExpiry && r.body.credentials?.magPortal?.endsWith("/portal.php"));
  r = await panelPost({ action: "reseller/payment-record", username: clientUsername, amount: 300, months: 1, via: "cash" }, resellerHeaders); check("payment-record extension consumes one credit", r.status === 200 && r.body.creditsLeft === 1 && r.body.creditsUsed === 1);
  r = await panelPost({ action: "reseller/client-update", username: clientUsername, note: "updated", devices: 2 }, resellerHeaders); check("reseller client update works", r.status === 200 && r.body.client?.note === "updated" && r.body.client?.devices === 2);
  r = await panelPost({ action: "reseller/client-renew", username: clientUsername }, resellerHeaders); check("reseller renewal consumes credit", r.status === 200 && typeof r.body.creditsLeft === "number");
  r = await panelPost({ action: "admin/xtream/update", username: clientUsername, expDate: Math.floor(Date.now() / 1000) + 3 * 86400 }, pinHeaders);
  r = await panelPost({ action: "reseller/report" }, resellerHeaders); check("report includes active clients expiring within seven days", r.body.report?.stats.expiringSoon === 1 && r.body.report?.expiringClients?.[0]?.username === clientUsername && !("password" in r.body.report.expiringClients[0]));
  r = await panelPost({ action: "reseller/clients" }, resellerHeaders); check("reseller client list does not expose passwords", r.status === 200 && r.body.clients.some((c) => c.username === clientUsername) && r.body.clients.every((c) => !("password" in c)));
  r = await panelPost({ action: "reseller/report" }, resellerHeaders); check("reseller report tracks own business activity and finance", r.status === 200 && r.body.report.stats.total === 1 && r.body.report.finance.collectedTotal === 600 && r.body.report.activity.some((e) => e.action === "payment.recorded") && !JSON.stringify(r.body).includes(resellerKey));
  r = await request(`/api/panel?action=admin/reseller-report&code=${resellerCode}`, { headers: pinHeaders }); check("owner API can inspect reseller report", r.status === 200 && r.body.report.reseller.code === resellerCode && r.body.report.activity.some((e) => e.action === "client.created"));
  r = await request(`/api/panel?action=admin/reseller-report&code=${resellerCode}`, { headers: resellerHeaders }); check("reseller key cannot access owner report", r.status === 401);
  r = await panelPost({ action: "admin/credits-topup", code: resellerCode, credits: -10 }, pinHeaders); check("negative topups are rejected", r.status === 400);
  r = await panelPost({ action: "admin/reseller-update", code: resellerCode, patch: { status: "suspended", credits: 9999 } }, pinHeaders); check("owner can suspend reseller without mass assignment of credits", r.status === 200 && r.body.reseller.status === "suspended" && r.body.reseller.credits !== 9999);
  r = await panelPost({ action: "reseller/report" }, resellerHeaders); check("suspended reseller API key is blocked", r.status === 401);
  r = await panelPost({ action: "admin/reseller-update", code: resellerCode, patch: { status: "active" } }, pinHeaders); check("owner can reactivate reseller", r.status === 200 && r.body.reseller.status === "active");
  r = await request("/api/panel?action=reseller/key-rotate", { headers: resellerHeaders }); check("reseller mutations require POST", r.status === 405);
  r = await panelPost({ action: "reseller/register", name: "Other Dealer", email: `other${Date.now()}@test.com`, password: "otherpass" });
  const otherHeaders = { "x-api-key": r.body.reseller.apiKey };
  r = await panelPost({ action: "reseller/report" }, otherHeaders); check("reseller report is tenant scoped", r.status === 200 && r.body.report.stats.total === 0 && r.body.report.activity.every((e) => e.detail.resellerCode !== resellerCode) && !JSON.stringify(r.body).includes(clientUsername));
  r = await panelPost({ action: "reseller/credentials", username: clientUsername }, otherHeaders); check("resellers cannot read another dealer's client credentials", r.status === 404);
  r = await panelPost({ action: "reseller/key-rotate" }, resellerHeaders); check("reseller key rotates", r.status === 200 && r.body.apiKey?.startsWith("mzr_") && r.body.apiKey !== resellerKey);
  const newResellerKey = r.body.apiKey;
  r = await panelPost({ action: "reseller/me" }, resellerHeaders); check("old reseller key is invalid after rotation", r.status === 401);
  r = await panelPost({ action: "reseller/me" }, { "x-api-key": newResellerKey }); check("new reseller key works", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "reseller/client-create", name: "No Credit", planId: "quarterly" }, { "x-api-key": newResellerKey }); check("multi-month plan requires its full credit cost", r.status === 402);
  r = await panelPost({ action: "reseller/client-delete", username: clientUsername }, { "x-api-key": newResellerKey }); check("reseller deletes owned client", r.status === 200 && r.body.ok);

  const cleanupImport1 = await panelPost({ action: "admin/channel-delete", id: "ch_mz_test_one" }, pinHeaders);
  const cleanupImport2 = await panelPost({ action: "admin/channel-delete", id: "ch_mz_test_two" }, pinHeaders);
  const cleanupImport3 = await panelPost({ action: "admin/channel-delete", id: "ch_mz_large_body" }, pinHeaders);
  check("cleanup imported channels", cleanupImport1.status === 200 && cleanupImport2.status === 200 && cleanupImport3.status === 200);
  r = await panelPost({ action: "admin/xtream/delete", username: XU }, pinHeaders); check("cleanup admin MAC client", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "admin/xtream/delete", username: orderClient }, pinHeaders); check("cleanup order client", r.status === 200 && r.body.ok);
} catch (error) {
  check("suite completed without unexpected exception", false, error.stack || error.message);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => remoteServer.close(resolve));
  try { fs.rmSync(MIRROR, { force: true }); } catch {}
}
console.log(`\n${failed ? "❌" : "✅"} ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("✅ MIZANORA IPTV INTEGRATION SUITE PASSED!");
