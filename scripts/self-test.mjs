/**
 * Mizanora IPTV — self-test (fresh rebuild suite)
 * Structure checks + live HTTP smoke over every protocol:
 * site, admin lock, panel API (public/reseller/admin), Xtream, MAG portal,
 * embed API, signed links, COOP headers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./dev-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

/* ---------- structure ---------- */
console.log("\n📁 Structure");
for (const f of ["public/index.html", "public/admin.html", "public/embed.html", "public/embed.js",
  "public/assets/css/site.css", "public/assets/css/admin.css", "public/assets/js/site.js",
  "public/assets/js/admin.js", "public/assets/js/firebase-client.js", "public/assets/vendor/firebase-sdk.js",
  "api/panel.js", "api/xtream.js", "api/embed.js", "api/portal.js", "api/stream.js",
  "api/_lib/util.js", "api/_lib/rtdb.js", "api/_lib/auth.js", "api/_lib/store.js",
  "api/_handlers/panel.js", "api/_handlers/xtream.js", "api/_handlers/embed.js", "api/_handlers/portal.js", "api/_handlers/stream.js",
  "vercel.json", "package.json", "firebase/database.rules.json", "scripts/dev-server.mjs"]) {
  check(`exists ${f}`, fs.existsSync(path.join(ROOT, f)));
}
const fbClient = fs.readFileSync(path.join(ROOT, "public/assets/js/firebase-client.js"), "utf8");
check("firebase mizanoranet HARDCODED (apiKey+RTDB+appId)", fbClient.includes("HARDCODED") && fbClient.includes("mizanoranet-default-rtdb.firebaseio.com") && fbClient.includes("AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M") && fbClient.includes("1:1047231858393:web:7e9fa18b59172f806da0c8"));
const rtdb = fs.readFileSync(path.join(ROOT, "api/_lib/rtdb.js"), "utf8");
check("server RTDB URL + API key baked in", rtdb.includes("mizanoranet-default-rtdb.firebaseio.com") && rtdb.includes("AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M"));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase/database.rules.json"), "utf8"));
check("firebase rules lock panel to owner email", JSON.stringify(rules).includes("muaaziqbal.vip@gmail.com"));
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const srcs = (vj.rewrites || []).map((r) => r.source);
for (const need of ["/player_api.php", "/get.php", "/xmltv.php", "/live/(.*)", "/movie/(.*)", "/series/(.*)", "/portal.php", "/stalker_portal/(.*)", "/c/(.*)", "/s/(.*)", "/admin"]) {
  check(`vercel rewrite ${need}`, srcs.includes(need));
}
check("vercel COOP same-origin-allow-popups on / + /admin", (vj.headers || []).filter((h) => ["/", "/admin", "/admin.html"].includes(h.source)).every((h) => (h.headers || []).some((x) => x.key === "Cross-Origin-Opener-Policy" && x.value === "same-origin-allow-popups")));
const adminHtml = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin.js"), "utf8");
check("admin lock overlay ids present", ["adminLock", "lockGoogleBtn", "lockGoogleRedirectBtn", "lockPinIn", "lockPinBtn", "lockErr"].every((id) => adminHtml.includes(`id="${id}"`)));
check("admin.js hardened: setText/safe/TAB_VIEWS + idempotent init", adminJs.includes("const setText") && adminJs.includes("const safe") && adminJs.includes("apikeys: \"viewApiKeys\"") && adminJs.includes("__mzAdminInit"));
check("13 tabs ↔ views consistent", ["viewDashboard","viewChannels","viewPlaylists","viewXtream","viewMovies","viewSeries","viewAnalytics","viewUsers","viewSettings","viewResellers","viewOrders","viewStalker","viewApiKeys"].every((v) => adminHtml.includes(`id="${v}"`)));

/* ---------- live HTTP ---------- */
console.log("\n🌐 Live HTTP");
const server = createAppServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p, opts) => {
  const res = await fetch(base + p, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, headers: res.headers };
};
const post = (p, obj, headers = {}) => get(p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(obj) });

let r = await get("/");
check("GET / → 200 landing with brand + COOP header", r.status === 200 && r.text.includes("Mizanora IPTV") && (r.headers.get("cross-origin-opener-policy") || "").includes("same-origin-allow-popups"));
r = await get("/admin");
check("GET /admin → 200 lock screen", r.status === 200 && r.text.includes('id="adminLock"'));
r = await get("/embed.js"); check("GET /embed.js → 200 widget", r.status === 200 && r.text.includes("/api/embed"));
r = await get("/embed.html"); check("GET /embed.html → 200", r.status === 200);
r = await get("/assets/img/brand/miznaoraiptv-logo.png"); check("brand logo served", r.status === 200);
r = await get("/api/panel?action=help");
check("panel help self-docs", r.status === 200 && r.body.ok && Array.isArray(r.body.actions.reseller) && Array.isArray(r.body.actions.admin));
r = await get("/api/panel?action=config");
check("panel config = Mizanora brand + endpoints", r.status === 200 && r.body.brand === "Mizanora IPTV" && r.body.endpoints.playerApi.includes("/player_api.php"));
r = await get("/api/embed?action=health"); check("embed health ok", r.status === 200 && r.body.ok === true);
r = await get("/api/embed?action=channels"); check("embed channels list", r.status === 200 && r.body.ok && Array.isArray(r.body.channels));

// trial → xtream creds → protocols
r = await post("/api/panel", { action: "trial", email: "selftest" + Date.now() + "@test.com" });
check("trial claim → 201 + creds", r.status === 201 && r.body.ok && r.body.client.username && r.body.links.m3u);
const U = r.body.client.username, P = r.body.client.password;
r = await get(`/player_api.php?username=${U}&password=${P}`);
check("player_api auth=1", r.status === 200 && r.body.user_info && r.body.user_info.auth === 1);
r = await get(`/player_api.php?username=${U}&password=wrong`);
check("player_api bad pass auth=0", r.body.user_info && r.body.user_info.auth === 0);
r = await get(`/get.php?username=${U}&password=${P}&type=m3u_plus&output=m3u8`);
check("get.php M3U #EXTM3U", r.status === 200 && String(r.text).startsWith("#EXTM3U"));
r = await get(`/xmltv.php?username=${U}&password=${P}`);
check("xmltv EPG xml", r.status === 200 && String(r.text).includes("<tv"));
r = await get(`/live/${U}/${P}/1.m3u8`, { redirect: "manual" });
check("live url → 302 to signed /s/", r.status === 302 && (r.headers.get("location") || "").includes("/s/"));
const loc = r.headers.get("location") || "";
const locUrl = new URL(loc, base);
r = await get(locUrl.pathname + locUrl.search);
check("signed /s/ link → 200 m3u8", r.status === 200 && String(r.text).includes("#EXTM3U"));
r = await get("/s/tampered.token");
check("tampered /s/ → 403", r.status === 403);

// MAG portal
r = await get("/portal.php?action=handshake&mac=00:1A:79:00:00:01");
check("portal handshake → token", r.status === 200 && r.body.js && r.body.js.token);
const MAC_TOKEN = r.body.js.token;
r = await get(`/stalker_portal/server/load.php?mac=00:1A:79:00:00:01&token=${MAC_TOKEN}`);
check("stalker load → profile", r.status === 200 && r.body.js && r.body.js.mac === "00:1A:79:00:00:01");
r = await get("/c/portal.php"); check("/c/ portal landing → 200 html", r.status === 200 && String(r.text).includes("MAG Portal"));

// admin auth chain
r = await get("/api/panel?action=admin/me");
check("admin/me unauth → 401", r.status === 401);
r = await post("/api/panel", { action: "admin/pin-login", pin: "wrong" });
check("wrong PIN → 401", r.status === 401);
r = await post("/api/panel", { action: "admin/pin-login", pin: "03062015326" });
check("owner PIN → mzp_ token", r.status === 200 && String(r.body.token).startsWith("mzp_"));
const PIN = r.body.token;
const ph = { "x-admin-token": PIN };
r = await get("/api/panel?action=admin/me", { headers: ph });
check("admin/me with PIN → 200 owner", r.status === 200 && r.body.ok && r.body.owner === "muaaziqbal.vip@gmail.com");
r = await post("/api/panel", { action: "admin/api-key-create", label: "selftest" }, ph);
check("api-key-create → mzk_", r.status === 201 && String(r.body.apiKey).startsWith("mzk_"));
const MZK = r.body.apiKey;
const kh = { "x-api-key": MZK };
r = await get("/api/panel?action=admin/me", { headers: kh });
check("admin/me with mzk_ → 200", r.status === 200 && r.body.ok);
r = await post("/api/panel", { action: "admin/xtream/create", name: "Selftest", mac: "00:1A:79:00:00:01", days: 30 }, kh);
check("xtream create (MAC bind)", r.status === 200 && r.body.ok && r.body.client.mac === "00:1A:79:00:00:01");
const XU = r.body.client.username;
r = await post("/api/panel", { action: "admin/xtream/renew", username: XU, planId: "monthly" }, kh);
check("xtream renew", r.status === 200 && r.body.ok);
r = await get("/api/panel?action=admin/stalker/list", { headers: kh });
check("stalker/list sees MAC client", r.status === 200 && r.body.clients.some((c) => c.mac === "00:1A:79:00:00:01"));
r = await post("/api/panel", { action: "admin/xtream/suspend", username: XU }, kh);
check("xtream suspend", r.status === 200 && r.body.client.status === "suspended");
// revoke via sha256(mzk) — deterministic
const { createHash } = await import("node:crypto");
const hash = createHash("sha256").update(MZK).digest("hex");
r = await post("/api/panel", { action: "admin/api-key-revoke", hash }, kh);
check("api-key-revoke works", r.status === 200 && r.body.ok);
r = await get("/api/panel?action=admin/me", { headers: kh });
check("revoked mzk_ → 401 immediately", r.status === 401);
r = await post("/api/panel", { action: "admin/xtream/delete", username: XU }, ph);
check("cleanup xtream delete", r.status === 200 && r.body.ok);

// reseller lifecycle
r = await post("/api/panel", { action: "reseller/register", name: "Self Dealer", email: "dealer" + Date.now() + "@test.com", password: "pass1234", whatsapp: "03005550001" });
check("reseller/register → 201 + mzr_", (r.status === 200 || r.status === 201) && String(r.body.reseller?.apiKey || "").startsWith("mzr_"));
const RK = r.body.reseller.apiKey;
const rh = { "x-api-key": RK };
r = await post("/api/panel", { action: "reseller/client-create", name: "MAG Client", mac: "00:1A:79:AB:CD:01", days: 30 }, rh);
check("reseller client-create (MAC) → links+stalker", r.status === 200 && r.body.ok && r.body.links?.m3u && r.body.stalker?.portalUrl);
const CU = r.body.client.username;
r = await post("/api/panel", { action: "reseller/credentials", username: CU }, rh);
check("reseller credentials → full pkg", r.status === 200 && r.body.credentials?.m3u?.includes("/get.php") && r.body.credentials?.magPortal?.includes("/portal.php"));
r = await post("/api/panel", { action: "reseller/client-update", username: CU, note: "updated", devices: 2 }, rh);
check("reseller client-update", r.status === 200 && r.body.client?.note === "updated");
r = await post("/api/panel", { action: "reseller/client-renew", username: CU }, rh);
check("reseller client-renew", r.status === 200 && r.body.ok && typeof r.body.creditsLeft === "number");
r = await post("/api/panel", { action: "reseller/key-rotate" }, rh);
check("reseller key-rotate → new mzr_", r.status === 200 && String(r.body.apiKey).startsWith("mzr_") && r.body.apiKey !== RK);
const NEWK = r.body.apiKey;
r = await post("/api/panel", { action: "reseller/me" }, rh);
check("old mzr_ → 401 after rotate", r.status === 401);
r = await post("/api/panel", { action: "reseller/me" }, { "x-api-key": NEWK });
check("new mzr_ works", r.status === 200 && r.body.ok);
r = await post("/api/panel", { action: "reseller/client-delete", username: CU }, { "x-api-key": NEWK });
check("reseller client-delete", r.status === 200 && r.body.ok);

server.close();
console.log(`\n${failed ? "❌" : "✅"} ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("✅ MIZANORA IPTV FULL SYSTEM SUITE PASSED!");
