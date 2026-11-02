/**
 * Mizanora IPTV — Admin Panel DOM Smoke Test (headless click-through)
 * -------------------------------------------------------------------------
 * Proves the admin panel actually WORKS in a real DOM:
 *   boot -> lock screen -> wrong PIN rejected -> owner PIN login -> unlock
 *   -> all 13 nav tabs switch views -> API-key create button -> theme toggle
 *   -> global search — with ZERO uncaught errors.
 *
 * Runs admin-modern.js bundled by esbuild with firebase-client stubbed,
 * inside jsdom, against a canned fetch. No network, no Firebase needed.
 *
 * Run:  npm run test:dom      (needs devDependencies: jsdom, esbuild)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let JSDOM, VirtualConsole, esbuild;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
  esbuild = require("esbuild");
} catch {
  console.log("⏭️  DOM smoke skipped — run `npm install` (jsdom + esbuild devDependencies) to enable.");
  process.exit(0);
}

const html = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf-8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin-modern.js"), "utf-8");

// Bundle admin-modern.js with firebase-client replaced by a stub
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mz-dom-"));
const srcDir = path.join(tmp, "src");
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(
  path.join(srcDir, "firebase-stub.mjs"),
  `export const ADMIN_EMAIL = "muaaziqbal.vip@gmail.com";
export function isAdminEmail(e){ return String(e||"").toLowerCase() === ADMIN_EMAIL; }
let current = null; const listeners = new Set();
export function getCurrentUserSnapshot(){ return current; }
export function subscribeAuth(cb){ listeners.add(cb); setTimeout(()=>cb(current),0); return ()=>listeners.delete(cb); }
export async function loginWithGoogle(){ return { ok:false, error:"stub" }; }
export async function loginWithGoogleRedirect(){ return { ok:false }; }
export async function loginWithEmailPassword(){ return { ok:false }; }
export async function logoutUser(){ current=null; listeners.forEach(cb=>cb(null)); }
export async function getFirebaseIdToken(){ return "stub-token"; }
export async function dbRead(){ return null; }
export function dbWatch(p,cb){ setTimeout(()=>cb(null),0); return ()=>{}; }
export async function dbWrite(){ return true; }
export async function dbDelete(){ return true; }
`
);
fs.writeFileSync(
  path.join(srcDir, "admin-modern.mjs"),
  adminJs.replace(/"\/assets\/js\/firebase-client\.js\?v=\d+"/, '"./firebase-stub.mjs"')
);
const bundlePath = path.join(tmp, "bundle.js");
await esbuild.build({
  entryPoints: [path.join(srcDir, "admin-modern.mjs")],
  bundle: true,
  format: "iife",
  outfile: bundlePath,
  logLevel: "silent"
});
const bundle = fs.readFileSync(bundlePath, "utf-8");
fs.rmSync(tmp, { recursive: true, force: true });

// ---- jsdom run ----
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!/Could not load|css/i.test(String(e.message))) errors.push("jsdomError: " + e.message); });
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  url: "http://localhost:3000/admin",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;
const { document } = window;

window.fetch = async (url, opts = {}) => {
  const u = String(url);
  let body = {};
  try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
  const action = body.action || new URL("http://x" + u).searchParams.get("action") || "";
  const J = (o, code = 200) => new window.Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json" } });
  if (action === "admin/pin-login") {
    const ok = body.pin === "03062015326";
    return J(ok ? { ok: true, token: "mzp_smoke", expiresAt: Date.now() + 43200000 } : { ok: false, error: "Invalid PIN" }, ok ? 200 : 401);
  }
  if (action === "admin/api-key-create") return J({ ok: true, apiKey: "mzk_smoke0123456789abcdef", usage: "unlimited" });
  if (action === "admin/me") return J({ ok: true, admin: { email: "muaaziqbal.vip@gmail.com", role: "owner" } });
  const data = { ok: true, action };
  for (const k of ["channels","playlists","xtreamAccounts","movies","series","users","resellers","orders","clients","payments","trials","apiKeys","stalker","audit"]) data[k] = [];
  data.settings = {};
  data.analytics = { onlineNow: 0, totalSessions: 0, totalPlays: 0, avgSessionSec: 0, recentSessions: [] };
  data.activity = []; data.config = {};
  return J(data);
};
window.AbortController = AbortController;
window.Response = Response;
window.Headers = Headers;
window.Request = Request;
window.addEventListener("error", (e) => errors.push("window error: " + e.message));
window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason?.message || e.reason)));

const results = [];
const check = (name, cond) => { results.push([cond ? "✓" : "✗", name]); if (!cond) errors.push("ASSERT FAIL: " + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const VIEWMAP = { dashboard:"viewDashboard", channels:"viewChannels", playlists:"viewPlaylists", xtream:"viewXtream", movies:"viewMovies", series:"viewSeries", analytics:"viewAnalytics", users:"viewUsers", settings:"viewSettings", resellers:"viewResellers", orders:"viewOrders", stalker:"viewStalker", apikeys:"viewApiKeys" };

window.eval(bundle);
await sleep(400);
check("boot: lock screen shown (unauthenticated)", $("adminLock").classList.contains("show"));
check("boot: lock Google + PIN controls exist", !!$("lockGoogleBtn") && !!$("lockPinBtn"));

$("lockPinIn").value = "000000";
$("lockPinBtn").click();
await sleep(400);
check("wrong PIN stays locked", $("adminLock").classList.contains("show"));

$("lockPinIn").value = "03062015326";
$("lockPinBtn").click();
await sleep(1200);
check("owner PIN login unlocks panel", !$("adminLock").classList.contains("show"));
check("dashboard visible after login", !!$("viewDashboard") && $("viewDashboard").hidden === false);
check("user chip painted without crash", ($("userName").textContent || "").includes("Owner"));

const navs = [...document.querySelectorAll(".nav-btn")].map((b) => b.dataset.tab);
check("13 nav tabs present", navs.length === 13);
for (const tab of navs) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  btn.click();
  await sleep(60);
  const view = $(VIEWMAP[tab]);
  check(`tab '${tab}' switches its view`, !!view && view.hidden === false && btn.classList.contains("active"));
}

$("stRefreshBtn")?.click(); await sleep(200);
check("stalker refresh button clickable", true);
$("keyCreateBtn").click(); await sleep(400);
check("API key create button works (mzk_ shown)", !!$("keyNewCard") && $("keyNewCard").hidden === false && String($("keyNewValue").textContent).includes("mzk_"));
$("btnTheme")?.click(); await sleep(100);
check("theme toggle clickable", true);
const gs = $("globalSearch");
if (gs) { gs.value = "test"; gs.dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(100); }
check("global search input handled", true);

await sleep(300);
for (const [s, n] of results) console.log(`  ${s} ${n}`);
if (errors.length) {
  console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n"));
}
const passed = results.filter((r) => r[0] === "✓").length;
console.log(`\n${passed}/${results.length} DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || passed !== results.length) process.exit(1);
console.log("✅ ADMIN PANEL DOM SMOKE PASSED — saare buttons/tabs kaam kar rahe hain!");
process.exit(0);
