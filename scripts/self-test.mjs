/**
 * Mizanora IPTV — Admin-Only Panel Test Suite
 * --------------------------------------------
 * The repo is now a PRIVATE admin panel (public site removed; "/" -> /admin.html).
 * This suite verifies structure, the Google-owner lock, API keys (mzk_),
 * Xtream/Stalker admin actions and the live HTTP surface via the dev server.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out); else out.push(p);
  }
  return out;
}

/* ---------------- structure ---------------- */
console.log("\n== Structure (admin-only) ==");
const required = [
  "public/admin.html",
  "public/assets/css/admin-modern.css",
  "public/assets/css/admin-luxe.css",
  "public/assets/js/admin-modern.js",
  "public/assets/js/firebase-client.js",
  "public/assets/js/error-beacon.js",
  "public/assets/js/membership.js",
  "public/assets/vendor/firebase-sdk.js",
  "public/assets/img/brand/miznaoraiptv-logo.png",
  "public/assets/icons/icon-512.png",
  "public/media/coming-soon/index.m3u8",
  "api/admin.js", "api/media.js", "api/seo.js", "api/xtream.js",
  "api/_handlers/panel.js", "api/_handlers/embed.js", "api/_handlers/mag-portal.js",
  "api/_lib/adminauth.js", "api/_lib/rtdb.js", "api/_lib/panelstore.js",
  "data/catalog.js", "data/panel.js", "data/imdb-seed.js",
  "firebase/database.rules.json",
  "vercel.json", "scripts/dev-server.mjs", "scripts/self-test.mjs"
];
for (const rel of required) check(`File exists: ${rel}`, fs.existsSync(path.join(ROOT, rel)));

const removed = [
  "public/index.html", "public/reseller.html", "public/embed.html", "public/api.html",
  "public/admin-guide.html", "public/policies.html", "public/embed.js", "public/sw.js",
  "public/manifest.webmanifest", "public/assets/js/app.js", "public/assets/js/player.js",
  "public/assets/js/admin.js", "public/assets/css/styles.css"
];
for (const rel of removed) check(`Removed public file: ${rel}`, !fs.existsSync(path.join(ROOT, rel)));

const topApi = fs.readdirSync(path.join(ROOT, "api"), { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith(".js"));
check(`api/ top-level serverless functions <= 4 (actual: ${topApi.length})`, topApi.length <= 4);

/* ---------------- admin lock + branding ---------------- */
console.log("\n== Private lock & branding ==");
const adminHtml = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin-modern.js"), "utf8");
const luxeCss = fs.readFileSync(path.join(ROOT, "public/assets/css/admin-luxe.css"), "utf8");
const fbClient = fs.readFileSync(path.join(ROOT, "public/assets/js/firebase-client.js"), "utf8");
const rules = fs.readFileSync(path.join(ROOT, "firebase/database.rules.json"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

check("admin.html has full-screen lock screen (#adminLock + Google button)", adminHtml.includes('id="adminLock"') && adminHtml.includes('id="lockGoogleBtn"'));
check("admin.html loads new luxe theme CSS", /admin-luxe\.css\?v=\d+/.test(adminHtml));
check("admin.html is noindex (private panel)", /noindex/.test(adminHtml));
check("admin.html loads versioned admin-modern.js", /\/assets\/js\/admin-modern\.js\?v=\d+/.test(adminHtml));
check("admin-modern.js enforces owner-only Google login (isAdminEmail + deny + signOut)", adminJs.includes("isAdminEmail") && adminJs.includes("Access denied") && adminJs.includes("logoutUser"));
check("admin-modern.js shows lock when unauthenticated (showLock in ensureAdmin)", /showLock\(\)/.test(adminJs) && /function ensureAdmin/.test(adminJs));
check("admin-modern.js has business tabs (resellers/orders/stalker/api keys)", ["viewResellers", "viewOrders", "viewStalker", "viewApiKeys"].every(id => adminHtml.includes(`id="${id}"`)));
check("luxe CSS styles the lock screen + gsi button", luxeCss.includes(".lock-screen") && luxeCss.includes(".gsi-btn"));
check("firebase client locks ADMIN_EMAIL to muaaziqbal.vip@gmail.com", fbClient.includes('ADMIN_EMAIL = "muaaziqbal.vip@gmail.com"') && fbClient.includes("isAdminEmail"));
check("firebase client uses mizanoranet project config", fbClient.includes('projectId: "mizanoranet"') && fbClient.includes("mizanoranet-default-rtdb"));
check("firebase config HARDCODED in repo (no Vercel env needed)", fbClient.includes("HARDCODED IN THE REPO") && fbClient.includes('apiKey: "AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M"') && fbClient.includes('appId: "1:1047231858393:web:7e9fa18b59172f806da0c8"'));
check("server-side RTDB URL + API key baked in too", fs.readFileSync(path.join(ROOT, "api/_lib/rtdb.js"), "utf8").includes('"https://mizanoranet-default-rtdb.firebaseio.com"') && fs.readFileSync(path.join(ROOT, "api/_lib/adminauth.js"), "utf8").includes('"AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M"'));
check("RTDB rules keep admin = muaaziqbal.vip@gmail.com (email_verified)", rules.includes("muaaziqbal.vip@gmail.com") && rules.includes("email_verified"));
check("vercel.json: root '/' rewrites to /admin.html", vercel.rewrites.some(r => r.source === "/" && r.destination === "/admin.html"));
check("vercel.json: no rewrites left to removed public pages", !vercel.rewrites.some(r => ["/reseller", "/pricing", "/blog", "/legal", "/sitemap.xml"].includes(r.source)));
check("vercel.json keeps Xtream/MAG/panel rewrites", ["/get.php", "/xmltv.php", "/player_api.php", "/portal.php", "/api/panel", "/api/embed"].every(s => vercel.rewrites.some(r => r.source === s)));
check("vercel.json headers valid + root noindex", vercel.headers.every(h => h.headers.every(v => typeof v.key === "string" && typeof v.value === "string")) && vercel.headers.some(h => h.source === "/" && h.headers.some(v => v.key === "X-Robots-Tag")));
check("robots.txt disallows everything", fs.readFileSync(path.join(ROOT, "public/robots.txt"), "utf8").includes("Disallow: /"));

/* ---------------- data ---------------- */
console.log("\n== Data ==");
const { BRAND, DEFAULT_CHANNELS, CATEGORIES } = await import(pathToFileURL(path.join(ROOT, "data/catalog.js")).href);
const { DEFAULT_MOVIES, DEFAULT_SERIES } = await import(pathToFileURL(path.join(ROOT, "data/imdb-seed.js")).href);
check("BRAND is Mizanora IPTV with owner email lock", BRAND.name === "Mizanora IPTV" && BRAND.ownerEmail === "muaaziqbal.vip@gmail.com");
check(`Channel catalog loaded (${DEFAULT_CHANNELS.length} channels, ${CATEGORIES.length} categories)`, DEFAULT_CHANNELS.length >= 10 && CATEGORIES.length >= 5);
check(`IMDb VOD seed intact (${DEFAULT_MOVIES.length} movies, ${DEFAULT_SERIES.length} series)`, DEFAULT_MOVIES.length >= 1000 && DEFAULT_SERIES.length >= 400);

/* ---------------- module graph ---------------- */
console.log("\n== Module graph ==");
const files = walkFiles(ROOT).filter(f => /\.(js|mjs)$/.test(f) && !f.endsWith("check-module-exports.mjs")); // meta-script contains sample specifiers
let dangling = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const base = path.resolve(path.dirname(f), m[1].split("?")[0]);
    if (!fs.existsSync(base)) { dangling++; console.error(`    dangling: ${f} -> ${m[1]}`); }
  }
}
check(`No dangling relative imports across ${files.length} js files`, dangling === 0);

/* ---------------- live HTTP smoke ---------------- */
console.log("\n== Live HTTP (dev server) ==");
const { createAppServer } = await import(pathToFileURL(path.join(ROOT, "scripts/dev-server.mjs")).href);
const server = createAppServer();
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p, opts) => { const r = await fetch(base + p, opts); return { status: r.status, text: await r.text(), json: null }; };
const jget = async (p, opts) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json() }; };

let r = await get("/");
check(`GET / serves the locked admin panel (${r.status})`, r.status === 200 && r.text.includes('id="adminLock"') && r.text.includes("lockGoogleBtn"));
r = await get("/admin");
check("GET /admin -> admin panel 200", r.status === 200 && r.text.includes("adminLock"));
r = await get("/index.html");
check("GET /index.html -> 404 (public site removed)", r.status === 404);
r = await get("/reseller");
check("GET /reseller -> 404 (removed)", r.status === 404);
r = await get("/assets/css/admin-luxe.css");
check("luxe CSS served 200", r.status === 200);
r = await get("/assets/img/brand/miznaoraiptv-logo.png");
check("Mizanora logo served 200", r.status === 200);
r = await get("/media/coming-soon/index.m3u8");
check("coming-soon video playlist served", r.status === 200 && r.text.includes("EXTM3U"));

let j = await jget("/api/panel?action=config");
check("panel config public OK (brand Mizanora IPTV)", j.status === 200 && j.body.ok && j.body.brand === "Mizanora IPTV");
j = await jget("/api/embed?action=health");
check("embed API health OK", j.status === 200 && j.body.ok === true);
j = await jget("/api/embed?action=channels&limit=5");
check(`embed channels API (${j.body.count} channels)`, j.status === 200 && j.body.channels.length > 0);
r = await get("/get.php?username=demo&password=demo&type=m3u_plus&output=m3u8");
check("Xtream get.php M3U works", r.status === 200 && r.text.includes("#EXTM3U"));
r = await get("/player_api.php?username=demo&password=demo&action=get_live_categories");
check("Xtream player_api categories JSON", r.status === 200 && r.text.trim().startsWith("["));
r = await get("/xmltv.php?username=demo&password=demo");
check("EPG xmltv works", r.status === 200 && r.text.includes("<tv"));
j = await jget("/portal.php?action=handshake&mac=00:1A:79:00:00:01");
check("MAG/Stalker portal handshake issues token", j.status === 200 && Boolean(j.body.js?.token));

j = await jget("/api/panel?action=admin/xtream-accounts");
check("admin API without key -> 401 locked", j.status === 401);

// PIN login -> mzk_ API key -> manage xtream/stalker -> revoke
let pin = await jget("/api/panel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/pin-login", pin: "03062015326" }) });
check("Owner PIN login issues mzp_ session", pin.status === 200 && String(pin.body.token || "").startsWith("mzp_"));
const pinTok = pin.body.token;
let mk = await jget("/api/panel", { method: "POST", headers: { "Authorization": "Bearer " + pinTok, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/api-key-create", label: "selftest" }) });
check("admin/api-key-create issues mzk_ key (shown once)", mk.status === 200 && String(mk.body.apiKey || "").startsWith("mzk_"));
const mzk = mk.body.apiKey;
j = await jget("/api/panel?action=admin/me", { headers: { "x-api-key": mzk } });
check("mzk_ key authenticates admin API (via x-api-key)", j.status === 200 && j.body.ok && j.body.admin.via === "api-key");
j = await jget("/api/panel", { method: "POST", headers: { "x-api-key": mzk, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/xtream/create", username: "selftest1", plan: "pro" }) });
check("mzk_ key creates Xtream user", j.status === 200 && j.body.xtream?.username === "selftest1");
j = await jget("/api/panel", { method: "POST", headers: { "x-api-key": mzk, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/xtream/renew", username: "selftest1", days: 30 }) });
check("xtream renew sets expiry", j.status === 200 && j.body.xtream?.expDate > 0);
j = await jget("/api/panel", { method: "POST", headers: { "x-api-key": mzk, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/xtream/update", username: "selftest1", mac: "00:1A:79:DE:AD:01" }) });
check("xtream update binds MAC (Stalker)", j.status === 200 && j.body.xtream?.mac === "00:1A:79:DE:AD:01");
j = await jget("/api/panel?action=admin/stalker/list", { headers: { "x-api-key": mzk } });
check(`stalker/list sees MAC client (count=${j.body.count})`, j.status === 200 && j.body.stalker.some(c => c.mac === "00:1A:79:DE:AD:01"));
j = await jget("/api/panel", { method: "POST", headers: { "x-api-key": mzk, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/xtream/suspend", username: "selftest1" }) });
check("xtream suspend works", j.status === 200 && j.body.xtream?.status === "Suspended");
const { hashApiKey } = await import(pathToFileURL(path.join(ROOT, "api/_lib/licenses.js")).href);
const keyHash = hashApiKey(mzk); // deterministic: revoke exactly the key we created
j = await jget("/api/panel", { method: "POST", headers: { "Authorization": "Bearer " + pinTok, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/api-key-revoke", hash: keyHash }) });
check("api-key-revoke works", j.status === 200 && j.body.ok);
j = await jget("/api/panel?action=admin/me", { headers: { "x-api-key": mzk } });
check("revoked mzk_ key -> 401 immediately", j.status === 401);
j = await jget("/api/panel", { method: "POST", headers: { "Authorization": "Bearer " + pinTok, "Content-Type": "application/json" }, body: JSON.stringify({ action: "admin/xtream/delete", username: "selftest1" }) });
check("cleanup: xtream delete", j.status === 200 && j.body.ok);

j = await jget("/api/panel?action=help");
check("help/docs action self-documents all APIs", j.status === 200 && j.body.ok && Array.isArray(j.body.actions.reseller) && j.body.actions.reseller.some(a => a.includes("client-credentials")) === false && j.body.actions.reseller.some(a => a.includes("reseller/credentials")));

// full reseller lifecycle via API key
let reg = await jget("/api/panel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reseller/register", name: "Suite Dealer", email: "suite@test.com", password: "pass1234", whatsapp: "03005550001" }) });
check("reseller/register returns code + mzr_ key (201)", (reg.status === 200 || reg.status === 201) && String(reg.body.reseller?.apiKey || reg.body.apiKey || "").startsWith("mzr_")); if (!(reg.status === 200)) console.error("    register resp:", JSON.stringify(reg.body).slice(0, 200));
const rkey = reg.body.reseller.apiKey;
const rh = { "x-api-key": rkey, "Content-Type": "application/json" };
let cc = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/client-create", name: "Suite MAG", mac: "00:1A:79:SU:ITE:01".replace(/SU|ITE/g, "AB"), days: 30 }) });
check("reseller/client-create (MAC) works, links included", cc.status === 200 && cc.body.ok && cc.body.links?.m3u && cc.body.stalker?.portalUrl);
const cu = cc.body.client.username;
let cred = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/credentials", username: cu }) });
check("reseller/credentials returns full creds + m3u + epg + mag portal", cred.status === 200 && cred.body.credentials?.m3u?.includes("/get.php") && cred.body.credentials?.magPortal?.includes("/portal.php"));
let up = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/client-update", username: cu, note: "updated", devices: 2 }) });
check("reseller/client-update works", up.status === 200 && up.body.client?.note === "updated" && up.body.client?.devices === 2);
let rn = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/client-renew", username: cu }) });
check("reseller/client-renew consumes credit", rn.status === 200 && rn.body.ok && typeof rn.body.creditsLeft === "number");
let kr = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/key-rotate" }) });
check("reseller/key-rotate issues new mzr_ key", kr.status === 200 && String(kr.body.apiKey || "").startsWith("mzr_") && kr.body.apiKey !== rkey);
const rh2 = { "x-api-key": kr.body.apiKey, "Content-Type": "application/json" };
let oldKey = await jget("/api/panel", { method: "POST", headers: rh, body: JSON.stringify({ action: "reseller/me" }) });
check("old mzr_ key rejected after rotate (401)", oldKey.status === 401);
let okNew = await jget("/api/panel", { method: "POST", headers: rh2, body: JSON.stringify({ action: "reseller/me" }) });
check("new mzr_ key works", okNew.status === 200 && okNew.body.ok);
let del = await jget("/api/panel", { method: "POST", headers: rh2, body: JSON.stringify({ action: "reseller/client-delete", username: cu }) });
check("reseller/client-delete removes client", del.status === 200 && del.body.ok);

server.close();

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("✅ ADMIN-ONLY PANEL SUITE PASSED PERFECTLY!");
