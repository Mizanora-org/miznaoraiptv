/** Public site DOM smoke: channel player, PRO gate, trial and order forms. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (error) { console.error("❌ Run `npm install` before DOM tests.", error.message); process.exit(1); }
const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const siteJs = fs.readFileSync(path.join(ROOT, "public/assets/js/site.js"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { if (!/Could not load|css/i.test(e.message)) errors.push(e.message); });
vc.on("error", (...args) => errors.push(args.join(" ")));
const dom = new JSDOM(html, { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.Response = Response;
window.Headers = Headers;
window.Request = Request;
window.HTMLElement.prototype.scrollIntoView = function () {};
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
window.HTMLMediaElement.prototype.load = function () {};
const originalTimeout = window.setTimeout.bind(window);
let speedUpIntro = false;
window.setTimeout = (fn, ms, ...args) => originalTimeout(fn, speedUpIntro && ms === 8000 ? 80 : ms, ...args);
Object.defineProperty(window.navigator, "sendBeacon", { value: () => true, configurable: true });
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason?.message || e.reason)));

let latestHls = null;
class HlsStub {
  static isSupported() { return true; }
  constructor() { this.handlers = {}; this.destroyed = false; latestHls = this; }
  on(event, callback) { this.handlers[event] = callback; }
  loadSource(url) { this.url = url; }
  attachMedia(video) { this.video = video; this.handlers.manifest?.(); }
  destroy() { this.destroyed = true; }
}
HlsStub.Events = { MANIFEST_PARSED: "manifest", ERROR: "error" };
window.Hls = HlsStub;

let streamGate = null, streamRequests = 0;
const channels = [
  { id: "ch_free", streamId: 1001, name: "Free Demo TV", group: "Demo", tier: "free", logo: "" },
  { id: "ch_pro", streamId: 2001, name: "PRO Sports", group: "Sports", tier: "pro", logo: "" }
];
window.fetch = async (url, options = {}) => {
  const raw = String(url);
  const parsed = new URL(raw, "http://localhost:3000");
  const J = (data, status = 200) => new window.Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (parsed.pathname === "/api/embed" && parsed.searchParams.get("action") === "config") return J({ ok: true, brand: "Mizanora IPTV", plans: [{ id: "monthly", name: "1 Month", price: 200 }], links: { resellerPanel: "/reseller", developers: "/developers" }, experience: { intro: { enabled: true, url: "/media/welcome/video.mp4", durationSec: 8, skippable: true } } });
  if (parsed.pathname === "/api/embed" && parsed.searchParams.get("action") === "guide") return J({ ok: true, guide: [{ channel: channels[0], now: { title: "Morning News", start: Date.now() - 60000, stop: Date.now() + 60000 }, next: { title: "Next Show", start: Date.now() + 60000 } }] });
  if (parsed.pathname === "/api/embed" && parsed.searchParams.get("action") === "channels") return J({ ok: true, count: channels.length, channels });
  if (parsed.pathname === "/api/embed" && parsed.searchParams.get("action") === "stream") {
    streamRequests += 1;
    const id = parsed.searchParams.get("id");
    if (id === "ch_pro") return J({ ok: false, error: "PRO required" }, 403);
    if (streamGate) await streamGate;
    return J({ ok: true, url: "http://localhost:3000/s/signed.token", channel: channels[0] });
  }
  if (parsed.pathname === "/api/panel" && options.method === "POST") {
    const body = JSON.parse(options.body);
    if (body.action === "trial") {
      if (body.email === "used@test.com") return J({ ok: false, error: "Trial already claimed" }, 409);
      return J({ ok: true, client: { username: "dom_trial", password: "trial_pass", expDate: 1999999999 }, links: { m3u: "http://localhost:3000/get.php?username=dom_trial", epg: "http://localhost:3000/xmltv.php" } }, 201);
    }
    if (body.action === "order") return J({ ok: true, order: { id: "ORD-DOM", amount: 200 }, message: "Order received", whatsapp: "https://wa.me/923062015326" }, 201);
  }
  return J({ ok: false, error: "Not mocked: " + raw }, 404);
};

const results = [];
const check = (name, condition) => { results.push([condition ? "✓" : "✗", name]); if (!condition) errors.push("ASSERT FAIL: " + name); };
const sleep = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (id) => document.getElementById(id);
window.eval(siteJs);
await sleep(250);
check("live channels render as playable buttons", document.querySelectorAll("[data-channel]").length === 2 && $("stChannels").textContent === "2");
check("public now/next guide renders imported-style programme data", $("guideGrid").textContent.includes("Morning News") && $("guideGrid").textContent.includes("Next Show"));

const requestsBeforeIntro = streamRequests;
document.querySelector("[data-channel='ch_free']").click(); await sleep(30);
check("intro gates secure stream fetching", $("playerDialog").hasAttribute("open") && !$("introOverlay").hidden && $("introOverlay").style.getPropertyValue("--intro-duration") === "8s" && $("introChannel").textContent === "Free Demo TV" && streamRequests === requestsBeforeIntro && latestHls === null);
$("playerSkip").click(); await sleep();
check("skipping intro attaches signed HLS", latestHls?.url.includes("/s/") && latestHls?.video === $("liveVideo") && streamRequests === requestsBeforeIntro + 1);
const failedLiveHls = latestHls;
failedLiveHls.handlers.error(null, { fatal: true });
check("fatal stream error plays offline video with retry", $("playerStatus").classList.contains("err") && !$("playerRetry").hidden && latestHls?.url.includes("channel-offline"));
const fallbackHls = latestHls;
failedLiveHls.handlers.error(null, { fatal: true }); failedLiveHls.handlers.manifest();
check("stale live callbacks cannot replace offline fallback", latestHls === fallbackHls && $("playerStatus").textContent.includes("offline"));
const previousHls = latestHls;
$("playerRetry").click(); await sleep();
check("retry skips repeated intro and creates a fresh player", $("introOverlay").hidden && latestHls !== previousHls && !latestHls.destroyed);
$("playerClose").click();
check("closing player destroys HLS instance", latestHls.destroyed && !$("playerDialog").hasAttribute("open"));

document.querySelector("[data-channel='ch_free']").click(); await sleep(30); $("playerSkip").click(); await sleep();
const escapeHls = latestHls;
$("playerDialog").dispatchEvent(new window.Event("cancel", { bubbles: true, cancelable: true }));
check("native Escape/cancel also destroys playback and closes dialog", escapeHls.destroyed && !$("playerDialog").hasAttribute("open"));

const requestsBeforeIntroClose = streamRequests;
document.querySelector("[data-channel='ch_free']").click(); await sleep(30);
$("playerClose").click(); $("liveVideo").dispatchEvent(new window.Event("ended")); await sleep(30);
check("closing during intro cancels later playback", streamRequests === requestsBeforeIntroClose && !$("playerDialog").hasAttribute("open") && !$("liveVideo").getAttribute("src"));

document.querySelector("[data-channel='ch_pro']").click(); await sleep(30); $("playerSkip").click(); await sleep();
check("PRO channel shows trial gate and recharge video", !$("playerPro").hidden && !$("liveVideo").hidden && latestHls?.url.includes("pro-unlock") && $("playerStatus").textContent.includes("PRO"));
$("playerClose").click();

let releaseSlowStream;
streamGate = new Promise((resolve) => { releaseSlowStream = resolve; });
const hlsBeforeCancelledRequest = latestHls;
document.querySelector("[data-channel='ch_free']").click(); await sleep(30); $("playerSkip").click(); await sleep(30);
$("playerClose").click(); streamGate = null; releaseSlowStream(); await sleep();
check("closing during delayed secure fetch prevents late background playback", latestHls === hlsBeforeCancelledRequest && !$("playerDialog").hasAttribute("open"));

speedUpIntro = true;
const beforeTimedIntro = streamRequests;
document.querySelector("[data-channel='ch_free']").click(); await sleep(30);
$("liveVideo").dispatchEvent(new window.Event("ended")); await sleep(20);
check("short intro video ending does not skip the timed intro", streamRequests === beforeTimedIntro && !$("introOverlay").hidden);
await sleep(100);
check("eight-second intro transitions automatically to the selected channel", streamRequests === beforeTimedIntro + 1 && latestHls?.url.includes("/s/") && $("introOverlay").hidden);
$("playerClose").click(); speedUpIntro = false;
$("cinemaPreview").click(); await sleep(30);
check("cinema preview plays coming-soon video", $("playerDialog").hasAttribute("open") && latestHls?.url.includes("coming-soon") && $("playerTitle").textContent.includes("Movies"));
$("playerClose").click();

$("trialEmail").value = "new@test.com";
$("trialWa").value = "03000000000";
$("trialForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await sleep(220);
check("trial form renders real returned credentials", $("credOut").textContent.includes("dom_trial") && $("credOut").textContent.includes("trial_pass") && !$("trialForm").querySelector("button").disabled);
$("trialEmail").value = "used@test.com";
$("trialForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await sleep(220);
check("trial API error reaches visible toast", $("toast").classList.contains("err") && $("toast").textContent.includes("already claimed"));

$("ordName").value = "DOM Buyer";
$("ordEmail").value = "buyer@test.com";
$("ordWa").value = "03000000000";
$("ordPlan").value = "monthly";
$("orderForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await sleep(220);
check("order form renders order ID and server amount", $("credOut").textContent.includes("ORD-DOM") && $("credOut").textContent.includes("Rs 200") && !$("orderForm").querySelector("button").disabled);

await sleep(100);
for (const [status, name] of results) console.log(`  ${status} ${name}`);
if (errors.length) console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 20).join("\n"));
const ok = results.filter((r) => r[0] === "✓").length;
console.log(`\n${ok}/${results.length} public DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || ok !== results.length) process.exit(1);
console.log("✅ PUBLIC PLAYER + FORMS DOM SUITE PASSED!");
process.exit(0);
