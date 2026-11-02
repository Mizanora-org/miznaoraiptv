/** Developer guide interactions and third-party embed widget DOM coverage. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (error) { console.error("❌ Run `npm install` before DOM tests.", error.message); process.exit(1); }
const results = [], errors = [];
const check = (name, condition) => { results.push([condition ? "✓" : "✗", name]); if (!condition) errors.push("ASSERT FAIL: " + name); };
const sleep = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
function consoleFor() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => { if (!/Could not load|css/i.test(error.message)) errors.push(error.message); });
  vc.on("error", (...args) => errors.push(args.join(" ")));
  return vc;
}

const guideHtml = fs.readFileSync(path.join(ROOT, "public/developers.html"), "utf8");
const guideJs = fs.readFileSync(path.join(ROOT, "public/assets/js/guide.js"), "utf8");
const guideDom = new JSDOM(guideHtml, { url: "https://docs.example/developers", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: consoleFor() });
const gw = guideDom.window, gd = gw.document;
let copied = "";
Object.defineProperty(gw.navigator, "clipboard", { value: { writeText: async (text) => { copied = text; } }, configurable: true });
gw.addEventListener("error", (event) => errors.push(event.message));
gw.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason?.message || event.reason)));
gw.eval(guideJs);
check("guide generates origin-specific public, Xtream and reseller examples", gd.getElementById("publicExample").textContent.includes("https://docs.example/api/embed?action=guide") && gd.getElementById("xtreamExample").textContent.includes("https://docs.example/xmltv.php") && gd.getElementById("resellerExample").textContent.includes("process.env.MZ_RESELLER_KEY"));
check("initial embed snippet uses script origin and safe defaults", gd.getElementById("embedCode").textContent.includes('src="https://docs.example/embed.js"') && gd.getElementById("embedCode").textContent.includes('data-limit="12"'));
gd.getElementById("embedTheme").value = "light"; gd.getElementById("embedLimit").value = "7"; gd.getElementById("embedCategory").value = "News";
gd.getElementById("embedCategory").dispatchEvent(new gw.Event("input", { bubbles: true }));
check("builder updates theme, limit and exact category", gd.getElementById("embedCode").textContent.includes('data-theme="light"') && gd.getElementById("embedCode").textContent.includes('data-limit="7"') && gd.getElementById("embedCode").textContent.includes('data-category="News"'));
gd.getElementById("embedLimit").value = "500"; gd.getElementById("embedLimit").dispatchEvent(new gw.Event("input", { bubbles: true }));
check("builder clamps excessive channel limits", gd.getElementById("embedCode").textContent.includes('data-limit="100"'));
gd.querySelector("[data-copy='resellerExample']").click(); await sleep();
check("guide copy buttons use the visible generated snippet", copied.includes("reseller/clients") && gd.getElementById("toast").textContent === "Code copied");

const embedJs = fs.readFileSync(path.join(ROOT, "public/embed.js"), "utf8");
async function runEmbed(category, channels) {
  const dom = new JSDOM(`<!doctype html><body><script src="https://iptv.example/embed.js" data-theme="light" data-limit="1" data-category="${category}"></script></body>`, { url: "https://customer.example/page", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: consoleFor() });
  let requested = "";
  dom.window.fetch = async (url) => { requested = String(url); return { ok: true, json: async () => ({ ok: true, channels }) }; };
  dom.window.eval(embedJs); await sleep();
  return { dom, requested };
}
const embedded = await runEmbed(" News ", [{ id: "ch_news", name: "News One", category: "News", tier: "free" }, { id: "ch_sport", name: "Sports Two", category: "Sports", tier: "pro" }, { id: "ch_news2", name: "News Two", category: "News", tier: "free" }]);
const mount = embedded.dom.window.document.querySelector("[data-mizanora-embed]");
check("third-party embed calls its own script origin, not customer localhost", embedded.requested === "https://iptv.example/api/embed?action=channels");
check("embed applies exact category and limit with secure channel links", mount.querySelectorAll("a").length === 2 && mount.textContent.includes("News One") && !mount.textContent.includes("News Two") && !mount.textContent.includes("Sports Two") && mount.querySelector("a").href === "https://iptv.example/?channel=ch_news#channels" && mount.querySelector("a").rel === "noopener");
const empty = await runEmbed("Movies", [{ id: "ch_news", name: "News One", category: "News", tier: "free" }]);
check("embed shows a useful empty-category state", empty.dom.window.document.querySelector("[data-mizanora-embed]").textContent.includes("Is category mein channels available nahi"));

await sleep(40);
for (const [status, name] of results) console.log(`  ${status} ${name}`);
if (errors.length) console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 20).join("\n"));
const passed = results.filter((r) => r[0] === "✓").length;
console.log(`\n${passed}/${results.length} guide/embed DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || passed !== results.length) process.exit(1);
console.log("✅ DEVELOPER GUIDE + EMBED DOM SUITE PASSED!");
process.exit(0);
