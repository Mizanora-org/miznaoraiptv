/** Reseller workspace DOM integration: real JS + DOM with a stateful mocked panel API. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); }
catch (error) { console.error("❌ Run `npm install` before DOM tests.", error.message); process.exit(1); }
const html = fs.readFileSync(path.join(ROOT, "public/reseller.html"), "utf8");
const resellerJs = fs.readFileSync(path.join(ROOT, "public/assets/js/reseller.js"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (error) => { if (!/Could not load|css/i.test(error.message)) errors.push(error.message); });
vc.on("error", (...args) => errors.push(args.join(" ")));
const dom = new JSDOM(html, { url: "http://localhost:3000/reseller", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const { document } = window;
window.Response = Response;
window.Headers = Headers;
window.Request = Request;
window.confirm = () => true;
window.HTMLElement.prototype.scrollIntoView = function () {};
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason?.message || event.reason)));
let copiedText = "";
Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (text) => { copiedText = text; } }, configurable: true });

const state = {
  code: "DOMDEALER", name: "DOM Dealer", credits: 5, pricing: { monthly: 200, quarterly: 550, yearly: 2000, connectionFee: 0 },
  validKey: "mzr_initial_dom", clients: [{ username: "existing", password: "oldpass", name: "Existing Client", planId: "monthly", status: "active", expDate: 1999999999, daysLeft: 30, expired: false }], payments: [], lastRequest: null
};
const publicClient = (client) => ({ ...client, password: undefined });
window.fetch = async (url, options = {}) => {
  const body = JSON.parse(options.body || "{}");
  const action = body.action || new URL(String(url), "http://localhost:3000").searchParams.get("action");
  state.lastRequest = { action, body, headers: options.headers || {} };
  const J = (value, status = 200) => new window.Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  if (action === "reseller/register") {
    state.code = "NEWDEALER"; state.name = body.name; state.validKey = "mzr_registered_dom";
    return J({ ok: true, reseller: { code: state.code, apiKey: state.validKey, credits: state.credits } }, 201);
  }
  const key = options.headers?.["x-api-key"];
  const authenticated = key === state.validKey || (body.code === state.code && body.password === (state.code === "DOMDEALER" ? "dealerpass" : "newpass"));
  if (!authenticated) return J({ ok: false, error: "Invalid reseller credentials" }, 401);
  if (action === "reseller/me") {
    const active = state.clients.filter((c) => c.status === "active" && !c.expired).length;
    return J({ ok: true, reseller: { code: state.code, name: state.name, status: "active", credits: state.credits, pricing: state.pricing }, stats: { active, expired: 0, suspended: state.clients.length - active }, finance: { credits: state.credits, collectedTotal: state.payments.reduce((sum, p) => sum + p.amount, 0) }, clients: state.clients.map(publicClient) });
  }
  if (action === "reseller/ledger") return J({ ok: true, payments: state.payments });
  if (action === "reseller/client-create") {
    if (state.credits < 1) return J({ ok: false, error: "Insufficient credits" }, 402);
    state.credits -= 1;
    const client = { username: "dom_client", password: "clientpass", name: body.name, whatsapp: body.whatsapp, planId: body.planId, status: "active", expDate: 1999999999, daysLeft: 30, expired: false };
    state.clients.push(client);
    return J({ ok: true, client, creditsLeft: state.credits, links: { m3u: "http://localhost:3000/get.php?username=dom_client", epg: "http://localhost:3000/xmltv.php" } }, 201);
  }
  const client = state.clients.find((c) => c.username === body.username);
  if (["reseller/credentials", "reseller/client-renew", "reseller/client-suspend", "reseller/client-delete", "reseller/payment-record"].includes(action) && !client) return J({ ok: false, error: "Client not found" }, 404);
  if (action === "reseller/credentials") return J({ ok: true, credentials: { username: client.username, password: client.password, serverUrl: "http://localhost:3000", m3u: "http://localhost:3000/get.php", epg: "http://localhost:3000/xmltv.php" } });
  if (action === "reseller/client-renew") { state.credits -= 1; client.daysLeft += 30; return J({ ok: true, creditsLeft: state.credits, client: publicClient(client) }); }
  if (action === "reseller/client-suspend") { client.status = body.suspended ? "suspended" : "active"; return J({ ok: true }); }
  if (action === "reseller/client-delete") { state.clients = state.clients.filter((c) => c.username !== client.username); return J({ ok: true }); }
  if (action === "reseller/payment-record") {
    state.credits -= Number(body.months || 0);
    state.payments.unshift({ username: client.username, amount: Number(body.amount), months: Number(body.months || 0), via: body.via, at: new Date().toISOString() });
    return J({ ok: true, creditsLeft: state.credits });
  }
  if (action === "reseller/pricing-set") { state.pricing = { ...body.pricing }; return J({ ok: true }); }
  if (action === "reseller/key-rotate") { state.validKey = "mzr_rotated_dom"; return J({ ok: true, apiKey: state.validKey }); }
  return J({ ok: false, error: "Not mocked: " + action }, 404);
};

const results = [];
const check = (name, condition) => { results.push([condition ? "✓" : "✗", name]); if (!condition) errors.push("ASSERT FAIL: " + name); };
const sleep = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (id) => document.getElementById(id);
const submit = async (id) => { $(id).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await sleep(220); };
window.eval(resellerJs);
await sleep();
check("logged-out reseller sees authentication, not dealer data", !$("resellerAuth").hidden && $("resellerApp").hidden);
$("dealerCode").value = "DOMDEALER"; $("dealerPassword").value = "wrong";
await submit("resellerLoginForm");
check("invalid dealer password stays locked with visible error", $("resellerApp").hidden && $("toast").textContent.includes("Invalid reseller"));
$("dealerPassword").value = "dealerpass";
await submit("resellerLoginForm");
check("code/password login loads dashboard and clients", !$("resellerApp").hidden && $("dealerName").textContent === "DOM Dealer" && $("dealerClients").textContent.includes("existing"));
check("password authentication is sent in request body", state.lastRequest.body.code === "DOMDEALER" && state.lastRequest.body.password === "dealerpass" && !state.lastRequest.headers["x-api-key"]);

$("clientName").value = "New DOM Client"; $("clientWhatsapp").value = "03000000000"; $("clientPlan").value = "monthly"; $("clientAmount").value = "250";
await submit("clientCreateForm");
check("client creation shows usable credentials and table row", !$("credentialOut").hidden && $("credentialOut").textContent.includes("dom_client") && $("credentialOut").textContent.includes("clientpass") && $("dealerClients").textContent.includes("New DOM Client"));
check("client creation consumes a credit", $("kCredits").textContent === "4" && state.credits === 4);
document.querySelector("[data-dealer-cred='dom_client']").click(); await sleep();
check("credentials action returns the selected client password", $("credentialOut").textContent.includes("Credentials · dom_client") && $("credentialOut").textContent.includes("clientpass"));
$("copyDealerCredentials").click(); await sleep();
check("copy control copies the complete credential text", copiedText.includes("Username: dom_client") && copiedText.includes("Password: clientpass"));
document.querySelector("[data-dealer-renew='dom_client']").click(); await sleep(220);
check("renew action updates server credits and dashboard", state.credits === 3 && $("kCredits").textContent === "3");
document.querySelector("[data-dealer-toggle='dom_client']").click(); await sleep(220);
check("suspend action changes client status", state.clients.find((c) => c.username === "dom_client").status === "suspended" && $("dealerClients").textContent.includes("Suspended"));
document.querySelector("[data-dealer-toggle='dom_client']").click(); await sleep(220);
check("same toggle reactivates the client", state.clients.find((c) => c.username === "dom_client").status === "active");

document.querySelector("[data-dealer-pay='dom_client']").click();
$("paymentAmount").value = "300"; $("paymentMonths").value = "1"; $("paymentVia").value = "JazzCash";
await submit("paymentForm");
check("payment action fills username, consumes extension credit and renders ledger", state.payments[0]?.username === "dom_client" && state.payments[0]?.amount === 300 && state.credits === 2 && $("dealerLedger").textContent.includes("Rs 300"));
$("priceMonthly").value = "275"; $("priceQuarterly").value = "750"; $("priceConnection").value = "50";
await submit("pricingForm");
check("pricing form persists dealer retail prices", state.pricing.monthly === 275 && state.pricing.quarterly === 750 && state.pricing.connectionFee === 50);
$("dealerClientSearch").value = "no-such-client"; $("dealerClientSearch").dispatchEvent(new window.Event("input", { bubbles: true }));
check("client search has a genuine empty state", $("dealerClients").textContent.includes("No matching clients") && !$("dealerClients").textContent.includes("dom_client"));
$("dealerClientSearch").value = ""; $("dealerClientSearch").dispatchEvent(new window.Event("input", { bubbles: true }));
$("rotateKeyBtn").click(); await sleep();
const storedAuth = JSON.parse(window.sessionStorage.getItem("mz_reseller_auth"));
check("key rotation visibly returns and stores only the new key", !$("credentialOut").hidden && $("credentialOut").textContent.includes("mzr_rotated_dom") && storedAuth.apiKey === "mzr_rotated_dom");
$("dealerRefresh").click(); await sleep(220);
check("post-rotation requests authenticate with x-api-key", state.lastRequest.headers["x-api-key"] === "mzr_rotated_dom" && !state.lastRequest.body.password);
document.querySelector("[data-dealer-del='dom_client']").click(); await sleep(220);
check("dealer can delete only the selected client from workspace", !state.clients.some((c) => c.username === "dom_client") && state.clients.some((c) => c.username === "existing"));
$("dealerLogout").click();
check("logout removes session credentials and relocks panel", !$("resellerAuth").hidden && $("resellerApp").hidden && !window.sessionStorage.getItem("mz_reseller_auth"));

$("regName").value = "Registered Dealer"; $("regEmail").value = "new@dealer.test"; $("regWhatsapp").value = "03001112222"; $("regPassword").value = "newpass";
await submit("resellerRegisterForm");
check("registration provisions a dealer and displays one-time API key", !$("resellerApp").hidden && $("dealerName").textContent === "Registered Dealer" && $("credentialOut").textContent.includes("mzr_registered_dom"));
$("dealerLogout").click(); $("dealerApiKey").value = "mzr_registered_dom";
await submit("resellerLoginForm");
check("API-key login restores the workspace", !$("resellerApp").hidden && state.lastRequest.headers["x-api-key"] === "mzr_registered_dom");

await sleep(80);
for (const [status, name] of results) console.log(`  ${status} ${name}`);
if (errors.length) console.log(`\n❌ ERRORS (${errors.length}):\n` + errors.slice(0, 20).join("\n"));
const passed = results.filter((r) => r[0] === "✓").length;
console.log(`\n${passed}/${results.length} reseller DOM checks passed, ${errors.length} uncaught errors`);
if (errors.length || passed !== results.length) process.exit(1);
console.log("✅ RESELLER WORKSPACE DOM SUITE PASSED!");
process.exit(0);
