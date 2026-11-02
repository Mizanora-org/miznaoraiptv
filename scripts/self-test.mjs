/** Mizanora IPTV integration suite — isolated offline RTDB mirror, real HTTP. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  "public/index.html", "public/admin.html", "public/embed.html", "public/embed.js",
  "public/assets/css/site.css", "public/assets/css/admin.css", "public/assets/js/site.js",
  "public/assets/js/admin.js", "public/assets/js/firebase-client.js", "public/assets/vendor/firebase-sdk.js", "public/assets/vendor/hls.min.js",
  "api/panel.js", "api/xtream.js", "api/embed.js", "api/portal.js", "api/stream.js",
  "api/_lib/util.js", "api/_lib/rtdb.js", "api/_lib/auth.js", "api/_lib/store.js",
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
for (const route of ["/player_api.php", "/get.php", "/xmltv.php", "/live/(.*)", "/movie/(.*)", "/series/(.*)", "/portal.php", "/stalker_portal/(.*)", "/c/(.*)", "/s/(.*)", "/admin"]) check(`vercel rewrite ${route}`, sources.includes(route));
check("COOP allows Firebase popup auth", (vercel.headers || []).filter((h) => ["/", "/admin", "/admin.html"].includes(h.source)).every((h) => h.headers.some((x) => x.key === "Cross-Origin-Opener-Policy" && x.value === "same-origin-allow-popups")));
const adminHtml = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin.js"), "utf8");
check("admin lock controls present", ["adminLock", "lockGoogleBtn", "lockGoogleRedirectBtn", "lockPinIn", "lockPinBtn", "lockErr"].every((id) => adminHtml.includes(`id="${id}"`)));
check("admin has real CRUD and dialog bindings", ["admin/channel-create", "admin/playlist-save", "admin/movie-update", "data-ch-edit", "openForm"].every((text) => adminJs.includes(text)));
check("13 tabs ↔ views consistent", Object.values({ dashboard:"viewDashboard", channels:"viewChannels", playlists:"viewPlaylists", xtream:"viewXtream", movies:"viewMovies", series:"viewSeries", analytics:"viewAnalytics", users:"viewUsers", settings:"viewSettings", resellers:"viewResellers", orders:"viewOrders", stalker:"viewStalker", apikeys:"viewApiKeys" }).every((id) => adminHtml.includes(`id="${id}"`)));
const { parseBody } = await import("../api/_lib/util.js");
check("Vercel pre-parsed JSON bodies are accepted", (await parseBody({ body: { action: "admin/me" } })).action === "admin/me");

console.log("\n🌐 Real HTTP integration");
const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
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
  r = await request("/embed.js"); check("embed widget loads", r.status === 200 && r.text.includes("data-mizanora-embed"));
  r = await request("/api/embed?action=help"); check("embed help is not a dead link", r.status === 200 && r.body.ok && r.body.actions);
  r = await request("/api/embed?action=health"); check("health reports storage diagnostics", r.status === 200 && r.body.ok && r.body.storage && typeof r.body.storage.durableServerWrites === "boolean");
  r = await request("/api/panel?action=config"); check("public config and endpoints", r.status === 200 && r.body.brand === "Mizanora IPTV" && r.body.endpoints.magPortal.endsWith("/portal.php"));
  r = await request("/api/embed?action=channels"); check("default live catalog available", r.status === 200 && r.body.count >= 18);
  const firstChannel = r.body.channels[0];
  const proChannel = r.body.channels.find((c) => c.tier === "pro");
  r = await request("/api/embed?action=movies&limit=5"); check("built-in movie metadata fallback works", r.status === 200 && r.body.total > 1000 && r.body.movies.length === 5 && r.body.movies[0].rating);
  const firstMovie = r.body.movies[0];
  r = await request("/api/embed?action=series&limit=3"); check("built-in series metadata fallback works", r.status === 200 && r.body.total > 400 && r.body.series.length === 3 && r.body.series[0].episodeCount > 0);
  const firstSeries = r.body.series[0];
  r = await request("/api/embed?action=movies&limit=5&q=Maula"); check("catalog server search works", r.status === 200 && r.body.total >= 1 && r.body.movies.some((m) => /Maula/i.test(m.title)));
  r = await request(`/api/embed?action=stream&id=${firstChannel.id}`); check("free preview issues a signed token", r.status === 200 && r.body.url?.includes("/s/"));
  const publicPreview = r.body.url;
  r = await request(new URL(publicPreview).pathname); check("public signed preview is a valid HLS variant", r.status === 200 && r.text.includes("#EXT-X-STREAM-INF") && r.text.includes("/media/"));
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
  r = await request(`/xmltv.php?username=${U}&password=${P}`); check("XMLTV contains escaped channels", r.status === 200 && r.text.includes("<tv") && r.text.includes("<display-name>"));
  r = await request(`/live/${U}/${P}/${liveStreams[0].stream_id}.m3u8`, { redirect: "manual" }); check("live URL redirects to signed /s/", r.status === 302 && r.headers.get("location")?.includes("/s/"));
  const signedPath = new URL(r.headers.get("location")).pathname;
  r = await request(signedPath); check("signed live playlist nests upstream as HLS variant", r.status === 200 && r.text.includes("#EXT-X-STREAM-INF") && !r.text.startsWith("#EXTM3U\n#EXTINF"));
  r = await request(`/live/${U}/${P}/does-not-exist.m3u8`, { redirect: "manual" }); const missingPath = new URL(r.headers.get("location")).pathname;
  r = await request(missingPath); check("unknown stream is 404, never random channel fallback", r.status === 404);
  r = await request("/s/tampered.token"); check("tampered signed token is rejected", r.status === 403);
  r = await request(`/api/panel?action=resolve&username=${U}`); check("username alone cannot disclose credentials", r.status === 401);
  r = await request(`/api/panel?action=resolve&username=${U}&password=${encodeURIComponent(P)}`); check("correct credentials resolve account links", r.status === 200 && r.body.links?.m3u.includes(P));
  r = await panelPost({ action: "track", sessionId: "selftest_session", event: "stream_play", route: "/channel/test" }); check("analytics event accepted", r.status === 202 && r.body.ok);

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
  const resellerKey = r.body.reseller.apiKey;
  const resellerHeaders = { "x-api-key": resellerKey };
  r = await panelPost({ action: "reseller/client-create", name: "MAG Client", mac: "00:1A:79:AB:CD:01", days: 9999, collectAmount: 300 }, resellerHeaders); check("reseller creates MAC client + links and cannot override plan days", r.status === 200 && r.body.links?.m3u && r.body.stalker?.portalUrl.endsWith("/portal.php") && r.body.client.expDate - r.body.client.startDate === 30 * 86400);
  const clientUsername = r.body.client.username, initialExpiry = r.body.client.expDate;
  r = await panelPost({ action: "reseller/credentials", username: clientUsername }, resellerHeaders); check("initial payment does not double-extend expiry", r.status === 200 && r.body.client?.expDate === initialExpiry && r.body.credentials?.magPortal?.endsWith("/portal.php"));
  r = await panelPost({ action: "reseller/payment-record", username: clientUsername, amount: 300, months: 1, via: "cash" }, resellerHeaders); check("payment-record extension consumes one credit", r.status === 200 && r.body.creditsLeft === 1 && r.body.creditsUsed === 1);
  r = await panelPost({ action: "reseller/client-update", username: clientUsername, note: "updated", devices: 2 }, resellerHeaders); check("reseller client update works", r.status === 200 && r.body.client?.note === "updated" && r.body.client?.devices === 2);
  r = await panelPost({ action: "reseller/client-renew", username: clientUsername }, resellerHeaders); check("reseller renewal consumes credit", r.status === 200 && typeof r.body.creditsLeft === "number");
  r = await panelPost({ action: "reseller/key-rotate" }, resellerHeaders); check("reseller key rotates", r.status === 200 && r.body.apiKey?.startsWith("mzr_") && r.body.apiKey !== resellerKey);
  const newResellerKey = r.body.apiKey;
  r = await panelPost({ action: "reseller/me" }, resellerHeaders); check("old reseller key is invalid after rotation", r.status === 401);
  r = await panelPost({ action: "reseller/me" }, { "x-api-key": newResellerKey }); check("new reseller key works", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "reseller/client-create", name: "No Credit", planId: "quarterly" }, { "x-api-key": newResellerKey }); check("multi-month plan requires its full credit cost", r.status === 402);
  r = await panelPost({ action: "reseller/client-delete", username: clientUsername }, { "x-api-key": newResellerKey }); check("reseller deletes owned client", r.status === 200 && r.body.ok);

  r = await panelPost({ action: "admin/xtream/delete", username: XU }, pinHeaders); check("cleanup admin MAC client", r.status === 200 && r.body.ok);
  r = await panelPost({ action: "admin/xtream/delete", username: orderClient }, pinHeaders); check("cleanup order client", r.status === 200 && r.body.ok);
} catch (error) {
  check("suite completed without unexpected exception", false, error.stack || error.message);
} finally {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(MIRROR, { force: true }); } catch {}
}
console.log(`\n${failed ? "❌" : "✅"} ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("✅ MIZANORA IPTV INTEGRATION SUITE PASSED!");
