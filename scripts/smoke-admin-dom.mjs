/** Real admin JavaScript click-through: login, tabs, forms, CRUD and search. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole, esbuild;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); esbuild = require("esbuild"); }
catch (error) {
  console.error("❌ DOM test dependencies missing. Run `npm install` first.", error.message);
  process.exit(1);
}

const html = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf-8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin.js"), "utf-8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mz-dom-"));
fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
fs.writeFileSync(path.join(tmp, "src/firebase-stub.mjs"), `
export const ADMIN_EMAIL="muaaziqbal.vip@gmail.com";
export function isAdminEmail(e){return String(e||"").toLowerCase()===ADMIN_EMAIL}
let current=null;const listeners=new Set();
export function subscribeAuth(cb){listeners.add(cb);setTimeout(()=>cb(current),0);return()=>listeners.delete(cb)}
export async function loginWithGoogle(){return{ok:false,error:"stub"}}
export async function loginWithGoogleRedirect(){return{ok:false}}
export async function finishRedirect(){return{ok:false}}
export async function logoutUser(){current=null;listeners.forEach(cb=>cb(null))}
export async function getFirebaseIdToken(){return null}
`);
fs.writeFileSync(path.join(tmp, "src/admin.mjs"), adminJs.replace(/"\/assets\/js\/firebase-client\.js\?v=[\d.]+"/, '"./firebase-stub.mjs"'));
const bundlePath = path.join(tmp, "bundle.js");
await esbuild.build({ entryPoints: [path.join(tmp, "src/admin.mjs")], bundle: true, format: "iife", outfile: bundlePath, logLevel: "silent" });
const bundle = fs.readFileSync(bundlePath, "utf-8");
fs.rmSync(tmp, { recursive: true, force: true });

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => { if (!/Could not load|css/i.test(String(error.message))) errors.push("jsdomError: " + error.message); });
virtualConsole.on("error", (...args) => errors.push("console.error: " + args.join(" ")));
const dom = new JSDOM(html, { url: "http://localhost:3000/admin", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
const { window } = dom;
const { document } = window;
window.confirm = () => true;
window.AbortController = AbortController;
window.Response = Response;
window.Headers = Headers;
window.Request = Request;
window.addEventListener("error", (event) => errors.push("window error: " + event.message));
window.addEventListener("unhandledrejection", (event) => errors.push("unhandledrejection: " + (event.reason?.message || event.reason)));

const db = {
  channels: [{ id: "ch_bbc", streamId: 1001, name: "BBC World News", url: "/media/demo-live/index.m3u8", category: "News", tier: "free", status: "active" }],
  playlists: [], epgSources: [], lastImport: null,
  accounts: [], clients: [], stalker: [],
  movies: [{ id: "mov_test", streamId: 5001, title: "Test Movie", year: "2025", rating: "8.1", category: "Drama", streamAvailable: false }],
  series: [{ id: "ser_test", streamId: 10001, title: "Test Series", year: "2024", rating: "8.4", category: "Drama", episodeCount: 9, streamAvailable: false }],
  resellers: [
    { code: "ALPHA", name: "Alpha Dealer", email: "alpha@test.com", credits: 3, status: "active" },
    { code: "BETA", name: "Beta Dealer", email: "beta@test.com", credits: 5, status: "active" }
  ],
  orders: [{ id: "ORD-DOM", name: "DOM Buyer", whatsapp: "03000000000", planId: "monthly", amount: 200, status: "pending" }],
  keys: [], settings: {}, audit: [],
  analytics: { onlineNow: 1, totalSessions: 1, totalPlays: 1, avgSessionSec: 30, recentSessions: [{ id: "dom_session", event: "stream_play", route: "/channel/test", lastSeenAt: "2026-11-02T10:00:00Z" }] }
};
function clientFrom(body, prefix = "user") {
  const username = body.username || `${prefix}_${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);
  return { username, password: body.password || "secret123", name: body.name || username, status: "active", mac: body.mac || "", devices: Number(body.devices) || 1, expDate: now + Number(body.days || 30) * 86400, daysLeft: Number(body.days) || 30, expired: false, resellerCode: "" };
}
window.fetch = async (url, options = {}) => {
  const raw = String(url);
  let body = {};
  try { body = options.body ? JSON.parse(options.body) : {}; } catch {}
  const action = body.action || new URL("http://local" + raw).searchParams.get("action") || "";
  const J = (value, status = 200) => new window.Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  if (action === "health") return J({ ok: true, storage: { durableServerWrites: true } });
  if (action === "channels") return J({ ok: true, count: db.channels.length, channels: db.channels });
  if (action === "movies" || action === "series") {
    const query = new URL("http://local" + raw).searchParams.get("q")?.toLowerCase() || "";
    const list = db[action].filter((item) => item.title.toLowerCase().includes(query));
    return J({ ok: true, count: list.length, total: list.length, [action]: list });
  }
  if (action === "admin/pin-login") {
    const ok = body.pin === "03062015326";
    return J(ok ? { ok: true, token: "mzp_dom", expiresIn: 43200 } : { ok: false, error: "Invalid Owner PIN" }, ok ? 200 : 401);
  }
  if (action === "admin/channels/import") {
    db.lastImport = body;
    const id = body.content ? "ch_file" : "ch_imported";
    if (!db.channels.some((c) => c.id === id)) db.channels.push({ id, streamId: 1002, name: body.content ? "File Channel" : "URL Channel", url: "/media/demo-live/index.m3u8", category: "Imports", tier: body.defaultTier || "free", status: "active", epgId: "dom.guide" });
    return J({ ok: true, imported: 1, created: 1, updated: 0, skipped: 0, total: db.channels.length, playlistId: "pl_import", epgImports: body.importEpg ? [{ programmes: 2 }] : [] });
  }
  if (action === "admin/epg-sources") return J({ ok: true, sources: db.epgSources });
  if (action === "admin/epg-import") {
    db.epgSources = [{ id: "epg_dom", name: body.name || "DOM Guide", sourceType: body.url ? "remote" : "upload", sourceUrl: body.url || "", url: body.url || "", programmeCount: 2, channelCount: 1, status: "ready" }];
    return J({ ok: true, id: "epg_dom", channels: 1, programmes: 2, skipped: 0 });
  }
  if (action === "admin/epg-refresh") { db.lastEpgRefresh = body; return J({ ok: true, id: body.id, channels: 1, programmes: 2, skipped: 0 }); }
  if (action === "admin/epg-delete") { db.epgSources = db.epgSources.filter((s) => s.id !== body.id); return J({ ok: true }); }
  if (action === "admin/channels") return J({ ok: true, channels: db.channels });
  if (action === "admin/channel-create") {
    const channel = { ...body, id: "ch_dom", streamId: 2000, status: "active" }; delete channel.action;
    db.channels.push(channel); return J({ ok: true, channel }, 201);
  }
  if (action === "admin/channel-update") {
    const channel = db.channels.find((c) => c.id === body.id); Object.assign(channel, body.patch); return J({ ok: true, channel });
  }
  if (action === "admin/channel-move") { const i = db.channels.findIndex((c) => c.id === body.id); const [item] = db.channels.splice(i, 1); db.channels.splice(body.position - 1, 0, item); return J({ ok: true, channels: db.channels }); }
  if (action === "admin/channel-delete") { db.channels = db.channels.filter((c) => c.id !== body.id); return J({ ok: true }); }
  if (action === "admin/playlists") return J({ ok: true, playlists: db.playlists });
  if (action === "admin/playlist-save") {
    let playlist = db.playlists.find((p) => p.id === body.id);
    if (!playlist) { playlist = { id: body.id || "pl_dom" }; db.playlists.push(playlist); }
    Object.assign(playlist, body, { type: "m3u", updatedAt: "2026-11-02T10:00:00Z" }); return J({ ok: true, playlist });
  }
  if (action === "admin/playlist-delete") { db.playlists = db.playlists.filter((p) => p.id !== body.id); return J({ ok: true }); }
  if (action === "admin/xtream-accounts") return J({ ok: true, accounts: db.accounts });
  if (action === "admin/xtream/create") {
    const client = clientFrom(body, "dom");
    db.clients.push(client); db.accounts.push({ ...client, status: "Active" });
    if (client.mac) db.stalker.push(client);
    return J({ ok: true, client });
  }
  if (["admin/xtream/suspend", "admin/xtream/activate", "admin/xtream/renew"].includes(action)) {
    const account = db.accounts.find((a) => a.username === body.username);
    const client = db.clients.find((a) => a.username === body.username);
    if (action.endsWith("renew")) { account.expDate += 30 * 86400; client.expDate = account.expDate; }
    else { account.status = action.endsWith("suspend") ? "Suspended" : "Active"; client.status = action.endsWith("suspend") ? "suspended" : "active"; }
    return J({ ok: true, client });
  }
  if (action === "admin/xtream/delete") {
    db.accounts = db.accounts.filter((a) => a.username !== body.username); db.clients = db.clients.filter((a) => a.username !== body.username); return J({ ok: true });
  }
  if (action === "admin/clients") return J({ ok: true, clients: db.clients });
  if (action === "admin/stalker/list") return J({ ok: true, clients: db.stalker });
  if (action === "admin/movie-update") {
    const movie = db.movies.find((m) => m.id === body.id); movie.streamAvailable = !!body.patch.streamUrl; return J({ ok: true, movie });
  }
  if (action === "admin/resellers") return J({ ok: true, resellers: db.resellers });
  if (action === "admin/reseller-report") return J({ ok: true, report: { reseller: { code: new URL(String(url), "http://localhost").searchParams.get("code") }, stats: { total: 2, active: 1, expiringSoon: 1 }, finance: { collectedTotal: 500, creditsUsed: 2 }, activity: [{ at: "2026-11-02", action: "client.created", detail: { username: "demo" } }] } });
  if (action === "admin/reseller-update") { Object.assign(db.resellers.find((r) => r.code === body.code), body.patch); return J({ ok: true }); }
  if (action === "admin/credits-topup") { const reseller = db.resellers.find((r) => r.code === body.code); reseller.credits += Number(body.credits); return J({ ok: true, credits: reseller.credits }); }
  if (action === "admin/orders") return J({ ok: true, orders: db.orders });
  if (action === "admin/order-review") {
    const order = db.orders.find((o) => o.id === body.id); order.status = body.approve ? "approved" : "rejected";
    if (body.approve) { const client = clientFrom({ username: "order_dom" }); order.clientUsername = client.username; db.clients.push(client); db.accounts.push({ ...client, status: "Active" }); return J({ ok: true, order, client }); }
    return J({ ok: true, order });
  }
  if (action === "admin/settings") return J({ ok: true, settings: db.settings });
  if (action === "admin/settings-set") { Object.assign(db.settings, body.patch); return J({ ok: true, settings: db.settings }); }
  if (action === "admin/analytics") return J({ ok: true, analytics: db.analytics });
  if (action === "admin/errors") return J({ ok: true, errors: [] });
  if (action === "admin/audit") return J({ ok: true, audit: db.audit });
  if (action === "admin/api-key-create") {
    const key = { id: `k${db.keys.length + 1}`, label: body.label, createdAt: "2026-11-02T10:00:00Z", revoked: false, lastUsedAt: "" };
    db.keys.push(key); return J({ ok: true, apiKey: "mzk_dom0123456789abcdef", id: key.id, label: key.label }, 201);
  }
  if (action === "admin/api-keys") return J({ ok: true, keys: db.keys });
  if (action === "admin/api-key-revoke") { const key = db.keys.find((k) => k.id === body.id); key.revoked = true; return J({ ok: true }); }
  return J({ ok: true, action });
};

const results = [];
const check = (name, condition) => { results.push([condition ? "✓" : "✗", name]); if (!condition) errors.push("ASSERT FAIL: " + name); };
const sleep = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (id) => document.getElementById(id);
const clickTab = async (tab) => { document.querySelector(`.nav-btn[data-tab="${tab}"]`).click(); await sleep(40); };
async function submitDialog(values = {}) {
  for (const [name, value] of Object.entries(values)) {
    const field = $("dialogForm").elements.namedItem(name);
    if (field) field.value = value;
  }
  $("dialogForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await sleep(260);
}
const VIEWMAP = { studio:"viewStudio", academy:"viewAcademy", dashboard:"viewDashboard", channels:"viewChannels", playlists:"viewPlaylists", epg:"viewEpg", xtream:"viewXtream", movies:"viewMovies", series:"viewSeries", analytics:"viewAnalytics", users:"viewUsers", settings:"viewSettings", resellers:"viewResellers", orders:"viewOrders", stalker:"viewStalker", apikeys:"viewApiKeys" };

window.HTMLMediaElement.prototype.pause = function () {};
window.HTMLMediaElement.prototype.load = function () {};
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.eval(bundle);
await sleep(350);
check("unauthenticated lock is shown", $("adminLock").classList.contains("show"));
$("lockPinIn").value = "000000"; $("lockPinBtn").click(); await sleep(220);
check("wrong PIN stays locked", $("adminLock").classList.contains("show"));
$("lockPinIn").value = "03062015326"; $("lockPinBtn").click(); await sleep(650);
check("owner PIN unlocks and loads dashboard", !$("adminLock").classList.contains("show") && $("viewDashboard").hidden === false && $("userName").textContent.includes("Owner"));
const navs = [...document.querySelectorAll(".nav-btn")].map((b) => b.dataset.tab);
check("all 16 navigation tabs exist", navs.length === 16);
for (const tab of navs) {
  const button = document.querySelector(`.nav-btn[data-tab="${tab}"]`); button.click(); await sleep(25);
  check(`tab ${tab} switches view`, $(VIEWMAP[tab]).hidden === false && button.classList.contains("active"));
}

// Quick action used to be dead: now submit a real add-channel form.
$("qAddChannel").click(); await sleep(40);
check("quick Add Channel opens functional dialog", $("appDialog").hasAttribute("open") && !!$("dialogForm").elements.namedItem("url"));
await submitDialog({ name: "DOM Channel", url: "/media/demo-live/index.m3u8", category: "Testing", tier: "free" });
check("channel create updates API state and table", db.channels.some((c) => c.id === "ch_dom") && $("chBody").textContent.includes("DOM Channel"));
await clickTab("channels");
document.querySelector("[data-ch-move='ch_dom'][data-direction='-1']").click(); await sleep();
check("channel move control persists order", db.channels[0].id === "ch_dom" && $("chBody").querySelector("tr b").textContent === "DOM Channel");
document.querySelector("[data-ch-edit='ch_dom']").click(); await sleep(30);
await submitDialog({ name: "DOM Channel Edited", url: "/media/demo-live/index.m3u8", category: "Testing", tier: "pro" });
check("channel edit persists", db.channels.find((c) => c.id === "ch_dom")?.name === "DOM Channel Edited" && $("chBody").textContent.includes("PRO"));
document.querySelector("[data-ch-del='ch_dom']").click(); await sleep();
check("channel delete removes row", !db.channels.some((c) => c.id === "ch_dom") && !$("chBody").textContent.includes("DOM Channel Edited"));

$("m3uUrl").value = "https://example.test/channels.m3u"; $("m3uTier").value = "pro"; $("m3uImportEpg").checked = true;
$("m3uUrlBtn").click(); await sleep(320);
check("remote M3U import sends URL and updates channel table", db.lastImport?.url === "https://example.test/channels.m3u" && db.lastImport?.defaultTier === "pro" && $("chBody").textContent.includes("URL Channel") && $("m3uImportStatus").textContent.includes("1 created"));
const uploadFile = new window.File(["#EXTM3U\n#EXTINF:-1,File Channel\nhttps://example.test/live.m3u8\n"], "dom.m3u", { type: "audio/mpegurl" });
Object.defineProperty(uploadFile, "text", { value: async () => "#EXTM3U\n#EXTINF:-1 tvg-id=\"dom.guide\",File Channel\nhttps://example.test/live.m3u8\n" });
Object.defineProperty($("m3uFile"), "files", { value: [uploadFile], configurable: true });
$("m3uFileBtn").click(); await sleep(320);
check("M3U file input uploads parsed text to real import action", db.lastImport?.content?.includes("tvg-id=\"dom.guide\"") && db.channels.some((c) => c.id === "ch_file") && $("chBody").textContent.includes("File Channel"));

await clickTab("epg"); $("epgUrl").value = "https://example.test/guide.xml"; $("epgName").value = "DOM Guide";
$("epgUrlBtn").click(); await sleep(320);
check("EPG URL import updates source manager", db.epgSources.length === 1 && $("epgBody").textContent.includes("DOM Guide") && $("epgImportStatus").textContent.includes("2 programmes"));
document.querySelector("[data-epg-refresh='epg_dom']").click(); await sleep(260);
check("EPG refresh control calls backend", db.lastEpgRefresh?.id === "epg_dom");
document.querySelector("[data-epg-delete='epg_dom']").click(); await sleep(260);
check("EPG delete removes source", db.epgSources.length === 0 && !$("epgBody").textContent.includes("DOM Guide"));

await clickTab("playlists"); $("plAddBtn").click();
await submitDialog({ name: "DOM Playlist", url: "/media/demo-live/index.m3u8" });
check("playlist add works", db.playlists.length === 1 && $("plBody").textContent.includes("DOM Playlist"));
document.querySelector("[data-pl-edit='pl_dom']").click();
await submitDialog({ name: "DOM Playlist Edited", url: "/media/demo-live/index.m3u8" });
check("playlist edit works", db.playlists[0]?.name === "DOM Playlist Edited");
document.querySelector("[data-pl-del='pl_dom']").click(); await sleep();
check("playlist delete works", db.playlists.length === 0);

await clickTab("xtream"); $("xtAddBtn").click();
await submitDialog({ name: "DOM User", username: "dom_user", password: "dom_pass", days: "30", devices: "1" });
check("Xtream create form creates account", db.accounts.some((a) => a.username === "dom_user") && $("xtBody").textContent.includes("dom_user"));
document.querySelector("[data-xt-toggle='dom_user']").click(); await sleep();
check("suspend button changes status", db.clients.find((c) => c.username === "dom_user")?.status === "suspended" && $("xtBody").textContent.includes("Suspended"));
document.querySelector("[data-xt-toggle='dom_user']").click(); await sleep();
check("same control reactivates account", db.clients.find((c) => c.username === "dom_user")?.status === "active");
const beforeRenew = db.accounts.find((a) => a.username === "dom_user").expDate;
document.querySelector("[data-xt-renew='dom_user']").click(); await sleep();
check("renew extends expiry", db.accounts.find((a) => a.username === "dom_user").expDate > beforeRenew);

await clickTab("movies");
document.querySelector("[data-mv-stream='mov_test']").click();
await submitDialog({ streamUrl: "/media/welcome/video.mp4" });
check("movie stream form marks playback ready", db.movies[0].streamAvailable && $("mvBody").textContent.includes("Ready"));
$("mvSearch").value = "no such movie"; $("mvSearch").dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(350);
check("movie search queries catalog and shows empty state", $("mvBody").textContent.includes("No matching movies"));
$("mvSearch").value = ""; $("mvSearch").dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(300);

await clickTab("resellers");
$("rsSearch").value = "Beta"; $("rsSearch").dispatchEvent(new window.Event("input", { bubbles: true }));
check("reseller search filters locally without refetch", $("rsBody").textContent.includes("Beta Dealer") && !$("rsBody").textContent.includes("Alpha Dealer"));
$("rsSearch").value = ""; $("rsSearch").dispatchEvent(new window.Event("input", { bubbles: true }));
document.querySelector("[data-rs-topup='ALPHA']").click(); await submitDialog({ credits: "15" });
check("credit top-up form updates reseller", db.resellers.find((r) => r.code === "ALPHA")?.credits === 18);
document.querySelector("[data-rs-report='ALPHA']").click(); await sleep();
check("owner can view reseller activity report", !$("rsReport").hidden && $("rsReport").textContent.includes("client.created") && $("rsReport").textContent.includes("500"));
document.querySelector("[data-rs-toggle='ALPHA']").click(); await sleep();
check("owner can suspend a reseller", db.resellers.find((r) => r.code === "ALPHA").status === "suspended" && $("rsBody").textContent.includes("Activate"));
document.querySelector("[data-rs-toggle='ALPHA']").click(); await sleep();
check("owner can reactivate a reseller", db.resellers.find((r) => r.code === "ALPHA").status === "active");

await clickTab("settings"); $("stTicker").value = "DOM announcement"; $("stSave").click(); await sleep();
check("settings save sends actual patch", db.settings.siteAnnouncement === "DOM announcement");
await clickTab("orders"); document.querySelector("[data-or-approve='ORD-DOM']").click(); await sleep();
check("order approval provisions client and updates row", db.orders[0].status === "approved" && db.clients.some((c) => c.username === "order_dom"));
await clickTab("analytics");
check("recent sessions are rendered", $("sessBody").textContent.includes("dom_session") && $("sessBody").textContent.includes("stream_play"));

await clickTab("apikeys"); $("keyCreateBtn").click(); await sleep();
check("new API key box is genuinely visible", $("keyNewCard").hidden === false && !$("keyNewCard").classList.contains("hidden") && $("keyNewValue").textContent.startsWith("mzk_"));
document.querySelector("[data-key-revoke='k1']").click(); await sleep();
check("key revoke uses public ID and updates status", db.keys[0].revoked && $("keyBody").textContent.includes("Revoked"));

await clickTab("channels");
$("globalSearch").value = "definitely-no-match"; $("globalSearch").dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(300);
check("global search filters rendered data", $("chBody").textContent.includes("No matching channels"));
$("globalSearch").value = ""; $("globalSearch").dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(300);
await clickTab("dashboard"); $("qSearch").value = "BBC"; $("qGo").click();
check("quick search opens filtered channels", STATE_SAFE_TEXT("chBody").includes("BBC") && $("viewChannels").hidden === false);
function STATE_SAFE_TEXT(id) { return $(id).textContent || ""; }
$("btnTheme").click(); check("theme toggles", document.documentElement.dataset.theme === "light");
$("btnTheme").click(); $("btnRefresh").click(); await sleep(350);
check("global refresh completes", !$("btnRefresh").disabled);

await sleep(300);
for (const [status, name] of results) console.log(`  ${status} ${name}`);
if (errors.length) console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 20).join("\n"));
const ok = results.filter((r) => r[0] === "✓").length;
console.log(`\n${ok}/${results.length} DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || ok !== results.length) process.exit(1);
console.log("✅ ADMIN CRUD + UI INTERACTION SUITE PASSED!");
process.exit(0);
