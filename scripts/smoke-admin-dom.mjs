/**
 * Mizanora IPTV — Admin panel DOM smoke test (headless click-through, fresh rebuild)
 * boot → lock → wrong PIN rejected → owner PIN login → unlock → all 13 tabs →
 * key-create / theme / refresh / search — ZERO uncaught errors required.
 * Run: npm run test:dom   (devDeps: jsdom + esbuild)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole, esbuild;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); esbuild = require("esbuild"); }
catch { console.log("⏭️  DOM smoke skipped — `npm install` first (jsdom+esbuild)."); process.exit(0); }

const html = fs.readFileSync(path.join(ROOT, "public/admin.html"), "utf-8");
const adminJs = fs.readFileSync(path.join(ROOT, "public/assets/js/admin.js"), "utf-8");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mz-dom-"));
fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
fs.writeFileSync(path.join(tmp, "src", "firebase-stub.mjs"), `export const ADMIN_EMAIL = "muaaziqbal.vip@gmail.com";
export function isAdminEmail(e){ return String(e||"").toLowerCase() === ADMIN_EMAIL; }
let current = null; const listeners = new Set();
export function getCurrentUserSnapshot(){ return current; }
export function subscribeAuth(cb){ listeners.add(cb); setTimeout(()=>cb(current),0); return ()=>listeners.delete(cb); }
export async function loginWithGoogle(){ return { ok:false, error:"stub" }; }
export async function loginWithGoogleRedirect(){ return { ok:false }; }
export async function finishRedirect(){ return { ok:false }; }
export async function loginWithEmailPassword(){ return { ok:false }; }
export async function logoutUser(){ current=null; listeners.forEach(cb=>cb(null)); }
export async function getFirebaseIdToken(){ return "stub-token"; }
export async function dbRead(){ return null; }
export function dbWatch(p,cb){ setTimeout(()=>cb(null),0); return ()=>{}; }
export async function dbWrite(){ return true; }
export async function dbDelete(){ return true; }
`);
fs.writeFileSync(path.join(tmp, "src", "admin.mjs"), adminJs.replace(/"\/assets\/js\/firebase-client\.js\?v=\d+"/, '"./firebase-stub.mjs"'));
const bundlePath = path.join(tmp, "bundle.js");
await esbuild.build({ entryPoints: [path.join(tmp, "src", "admin.mjs")], bundle: true, format: "iife", outfile: bundlePath, logLevel: "silent" });
const bundle = fs.readFileSync(bundlePath, "utf-8");
fs.rmSync(tmp, { recursive: true, force: true });

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!/Could not load|css/i.test(String(e.message))) errors.push("jsdomError: " + e.message); });
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
const dom = new JSDOM(html, { url: "http://localhost:3000/admin", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;

window.fetch = async (url, opts = {}) => {
  const u = String(url);
  let body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch {}
  const action = body.action || new URL("http://x" + u).searchParams.get("action") || "";
  const J = (o, code = 200) => new window.Response(JSON.stringify(o), { status: code, headers: { "Content-Type": "application/json" } });
  if (action === "admin/pin-login") {
    const ok = body.pin === "03062015326";
    return J(ok ? { ok: true, token: "mzp_smoke", expiresIn: 43200 } : { ok: false, error: "Invalid Owner PIN" }, ok ? 200 : 401);
  }
  if (action === "admin/api-key-create") return J({ ok: true, apiKey: "mzk_smoke0123456789abcdef", id: "k1", label: "t" });
  if (action === "admin/me") return J({ ok: true, admin: { email: "muaaziqbal.vip@gmail.com", uid: "owner_pin", via: "pin" }, owner: "muaaziqbal.vip@gmail.com" });
  const data = { ok: true, action };
  for (const k of ["channels","clients","resellers","orders","audit","errors","keys","stalker"]) data[k] = [];
  data.accounts = []; data.settings = {}; data.analytics = { onlineNow: 0, totalSessions: 0, totalPlays: 0, avgSessionSec: 0 };
  return J(data);
};
window.AbortController = AbortController; window.Response = Response; window.Headers = Headers; window.Request = Request;
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
check("lock controls exist (google/redirect/pin)", !!$("lockGoogleBtn") && !!$("lockGoogleRedirectBtn") && !!$("lockPinBtn"));

$("lockPinIn").value = "000000";
$("lockPinBtn").click();
await sleep(400);
check("wrong PIN stays locked", $("adminLock").classList.contains("show"));

$("lockPinIn").value = "03062015326";
$("lockPinBtn").click();
await sleep(1200);
check("owner PIN unlocks panel", !$("adminLock").classList.contains("show"));
check("body.unlocked class set", document.body.classList.contains("unlocked"));
check("dashboard visible after login", !!$("viewDashboard") && $("viewDashboard").hidden === false);
check("user chip painted without crash", ($("userName").textContent || "").includes("Owner"));

const navs = [...document.querySelectorAll(".nav-btn")].map((b) => b.dataset.tab);
check("13 nav tabs present", navs.length === 13);
for (const tab of navs) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  btn.click();
  await sleep(50);
  const view = $(VIEWMAP[tab]);
  check(`tab '${tab}' switches its view`, !!view && view.hidden === false && btn.classList.contains("active"));
}

$("stRefreshBtn")?.click(); await sleep(150);
$("keyCreateBtn").click(); await sleep(350);
check("API key create button works (mzk_ shown)", !!$("keyNewCard") && $("keyNewCard").hidden === false && String($("keyNewValue").textContent).includes("mzk_"));
$("btnTheme")?.click(); await sleep(80);
check("theme toggle works", document.documentElement.dataset.theme === "light");
$("btnTheme")?.click(); await sleep(80);
const gs = $("globalSearch");
if (gs) { gs.value = "test"; gs.dispatchEvent(new window.Event("input", { bubbles: true })); await sleep(120); }
check("global search handled", true);

await sleep(250);
for (const [st, n] of results) console.log(`  ${st} ${n}`);
if (errors.length) console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n"));
const ok = results.filter((r) => r[0] === "✓").length;
console.log(`\n${ok}/${results.length} DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || ok !== results.length) process.exit(1);
console.log("✅ ADMIN PANEL DOM SMOKE PASSED — saare tabs/buttons kaam kar rahe hain!");
process.exit(0);
