/* Mizanora IPTV v6 — secure reseller workspace. Passwords are exchanged for a
 * 12-hour signed session; only the session token survives a page refresh. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = String(value ?? ""); };
  const STATE = { auth: null, profile: null, stats: {}, finance: {}, clients: [], payments: [], credentials: "" };
  function toast(message, error = false) {
    const item = $("toast"); if (!item) return;
    item.textContent = String(message); item.className = "toast show" + (error ? " err" : "");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { item.className = "toast"; }, 4500);
  }
  function saveAuth() {
    try { if (STATE.auth) sessionStorage.setItem("mz_reseller_auth", JSON.stringify(STATE.auth)); else sessionStorage.removeItem("mz_reseller_auth"); } catch {}
  }
  function loadAuth() {
    try {
      const value = JSON.parse(sessionStorage.getItem("mz_reseller_auth") || "null");
      if (value?.resellerToken || value?.apiKey?.startsWith("mzr_")) STATE.auth = value;
      else sessionStorage.removeItem("mz_reseller_auth");
    } catch {}
  }
  async function api(action, payload = {}, { auth = STATE.auth } = {}) {
    const headers = { "Content-Type": "application/json" }, body = { action, ...payload };
    if (auth?.resellerToken) headers["x-reseller-token"] = auth.resellerToken;
    else if (auth?.apiKey) headers["x-api-key"] = auth.apiKey;
    else if (auth?.code) { body.code = auth.code; body.password = auth.password; }
    const response = await fetch("/api/panel?action=" + encodeURIComponent(action), { method: "POST", headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status})`);
    if (data.resellerToken) { STATE.auth = { resellerToken: data.resellerToken }; saveAuth(); }
    return data;
  }
  function busy(form, value) {
    const button = form?.querySelector('button[type="submit"]');
    if (button) { button.disabled = value; button.dataset.original ||= button.textContent; button.textContent = value ? "Please wait…" : button.dataset.original; }
  }
  function clearPrivateData() {
    STATE.credentials = ""; STATE.clients = []; STATE.payments = []; STATE.profile = null;
    for (const id of ["credentialOut", "dealerClients", "dealerLedger", "dealerActivity", "dealerExpiring"]) if ($(id)) { $(id).replaceChildren(); if (id === "credentialOut") $(id).hidden = true; }
    for (const id of ["dealerName", "dealerCodeOut", "dealerUsernameOut", "kCredits", "kActive", "kExpired", "kCollected"]) setText(id, "—");
    document.querySelectorAll("#accountForm input, #brandingForm input").forEach((input) => { input.value = ""; });
  }
  function showAuth(message = "") {
    clearPrivateData();
    if ($("resellerAuth")) $("resellerAuth").hidden = false;
    if ($("resellerApp")) $("resellerApp").hidden = true;
    if ($("dealerLogout")) $("dealerLogout").hidden = true;
    setText("authOutput", message);
  }
  function showApp() {
    if ($("resellerAuth")) $("resellerAuth").hidden = true;
    if ($("resellerApp")) $("resellerApp").hidden = false;
    if ($("dealerLogout")) $("dealerLogout").hidden = false;
    window.MizanoraAcademy?.mountAll();
  }
  function showCredentials(title, text) {
    STATE.credentials = text; const box = $("credentialOut"); if (!box) return;
    box.hidden = false;
    box.innerHTML = `<h3>${esc(title)}</h3><div>${esc(text)}</div><button class="btn btn-ghost btn-sm" id="copyDealerCredentials" type="button">📋 Copy credentials</button>`;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      const area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select();
      const copied = document.execCommand?.("copy"); area.remove(); return !!copied;
    } catch { return false; }
  }
  const expiryText = (client) => client.expDate ? new Date(Number(client.expDate) * 1000).toLocaleDateString() : "—";
  function renderClients() {
    const query = String($("dealerClientSearch")?.value || "").trim().toLowerCase();
    const status = $("dealerClientStatus")?.value || "", sort = $("dealerClientSort")?.value || "expiry";
    const clients = STATE.clients.filter((client) => `${client.username} ${client.name || ""} ${client.whatsapp || ""}`.toLowerCase().includes(query))
      .filter((client) => !status || (status === "active" ? client.status === "active" && !client.expired : status === "expired" ? client.expired : client.status === "suspended"))
      .sort((a, b) => sort === "name" ? String(a.name || a.username).localeCompare(String(b.name || b.username)) : sort === "username" ? a.username.localeCompare(b.username) : Number(a.expDate || 0) - Number(b.expDate || 0));
    const body = $("dealerClients"); if (!body) return;
    body.innerHTML = clients.map((client) => {
      const active = client.status === "active" && !client.expired;
      const status = client.status === "suspended" ? '<span class="pill bad">Suspended</span>' : client.expired ? '<span class="pill warn">Expired</span>' : '<span class="pill ok">Active</span>';
      return `<tr><td><b>${esc(client.username)}</b><br><small>${esc(client.name || client.whatsapp || "")}</small></td><td>${esc(client.planId || "monthly")}</td><td>${status}</td><td>${Number(client.daysLeft || 0)}</td><td>${expiryText(client)}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-dealer-edit="${esc(client.username)}" title="Edit username / password / MAC">✏️</button><button class="btn btn-ghost btn-sm" data-dealer-cred="${esc(client.username)}" title="Credentials">🔑</button><button class="btn btn-ghost btn-sm" data-dealer-renew="${esc(client.username)}" title="Renew one month">🔄</button><button class="btn btn-ghost btn-sm" data-dealer-toggle="${esc(client.username)}" data-dealer-active="${active}" title="${active ? "Suspend" : "Activate"}">${active ? "⏸" : "▶"}</button><button class="btn btn-ghost btn-sm" data-dealer-pay="${esc(client.username)}" title="Record payment">💳</button><button class="btn btn-danger btn-sm" data-dealer-del="${esc(client.username)}" title="Delete">🗑</button></td></tr>`;
    }).join("") || '<tr><td colspan="6" class="empty">No matching clients. Create your first client above.</td></tr>';
  }
  function renderDashboard(data) {
    STATE.profile = data.reseller || {}; STATE.stats = data.stats || {}; STATE.finance = data.finance || {}; STATE.clients = data.clients || [];
    setText("dealerName", STATE.profile.name || STATE.profile.code || "Reseller");
    setText("dealerCodeOut", STATE.profile.code || "—"); setText("dealerUsernameOut", STATE.profile.username || STATE.profile.code?.toLowerCase() || "—");
    setText("dealerStatus", STATE.profile.status === "suspended" ? "Suspended" : "Active");
    setText("kCredits", STATE.finance.credits ?? STATE.profile.credits ?? 0); setText("kActive", STATE.stats.active || 0);
    setText("kExpired", Number(STATE.stats.expired || 0) + Number(STATE.stats.suspended || 0));
    setText("kCollected", "Rs " + Number(STATE.finance.collectedTotal || 0).toLocaleString());
    const pricing = STATE.profile.pricing || {};
    for (const [id, key, fallback] of [["priceMonthly", "monthly", 300], ["priceQuarterly", "quarterly", 800], ["priceYearly", "yearly", 2800], ["priceConnection", "connectionFee", 50]]) if ($(id)) $(id).value = pricing[key] ?? fallback;
    for (const [id, value] of Object.entries({ accountUsername: STATE.profile.username || STATE.profile.code?.toLowerCase(), accountName: STATE.profile.name, accountWhatsapp: STATE.profile.whatsapp })) if ($(id)) $(id).value = value || "";
    const branding = STATE.profile.branding || {};
    for (const [id, key] of [["brandMethod", "paymentMethod"], ["brandAccount", "paymentAccount"], ["brandTitle", "paymentTitle"], ["brandTagline", "tagline"]]) if ($(id)) $(id).value = branding[key] || "";
    if ($("dealerTopup")) {
      const link = new URL("https://wa.me/923062015326"); link.searchParams.set("text", `Mizanora reseller ${STATE.profile.code || ""} ke credits top-up karne hain.`); $("dealerTopup").href = link.toString();
    }
    if ($("brandedSiteLink")) $("brandedSiteLink").href = `/?reseller=${encodeURIComponent(STATE.profile.code || "")}`;
    renderClients();
  }
  async function loadDashboard() {
    setText("dealerNotice", "Refreshing dealer data…");
    const [dashboard, ledger, reportData] = await Promise.all([api("reseller/me"), api("reseller/ledger"), api("reseller/report")]);
    renderDashboard(dashboard); STATE.payments = ledger.payments || [];
    const report = reportData.report || {};
    if ($("dealerExpiring")) $("dealerExpiring").innerHTML = (report.expiringClients || []).map((c) => `<tr><td>${esc(c.username)}</td><td>${Number(c.daysLeft || 0)}</td><td>${expiryText(c)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">No clients expiring in the next 7 days.</td></tr>';
    if ($("dealerActivity")) $("dealerActivity").innerHTML = (report.activity || []).slice(0, 20).map((event) => `<tr><td>${esc(event.action)}</td><td>${esc(event.detail?.username || (event.detail?.credits ? `+${event.detail.credits} credits` : "—"))}</td><td>${esc(String(event.at || "").replace("T", " ").slice(0, 16))}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">No activity recorded yet.</td></tr>';
    if ($("dealerLedger")) $("dealerLedger").innerHTML = STATE.payments.slice(0, 20).map((payment) => `<tr><td>${esc(payment.username)}</td><td>Rs ${Number(payment.amount || 0)}</td><td>${Number(payment.months || 0)}</td><td>${esc(String(payment.at || "").slice(0, 10))}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No payments recorded yet.</td></tr>';
    setText("dealerNotice", `Last refreshed ${new Date().toLocaleTimeString()}`); showApp();
  }
  async function loginWith(candidate) {
    STATE.auth = candidate;
    const result = await api(candidate.apiKey ? "reseller/login" : "reseller/login-password");
    if (result.resellerToken) STATE.auth = { resellerToken: result.resellerToken };
    saveAuth(); await loadDashboard();
  }
  $("resellerLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    const apiKey = $("dealerApiKey").value.trim();
    const candidate = apiKey ? { apiKey } : { code: $("dealerCode").value.trim(), password: $("dealerPassword").value };
    if (!apiKey && (!candidate.code || !candidate.password)) { toast("Username/code + password ya API key enter karein.", true); busy(form, false); return; }
    try { await loginWith(candidate); $("dealerPassword").value = ""; $("dealerApiKey").value = ""; toast("🔐 Secure dealer session unlocked"); }
    catch (error) { STATE.auth = null; saveAuth(); showAuth(); toast(error.message, true); }
    finally { busy(form, false); }
  });
  $("resellerRegisterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    try {
      const result = await api("reseller/register", { name: $("regName").value.trim(), username: $("regUsername").value.trim() || undefined, email: $("regEmail").value.trim(), whatsapp: $("regWhatsapp").value.trim(), password: $("regPassword").value }, { auth: null });
      STATE.auth = result.resellerToken ? { resellerToken: result.resellerToken } : { apiKey: result.reseller.apiKey }; saveAuth();
      await loadDashboard();
      showCredentials("Reseller account ready — save this API key", `Panel: ${location.origin}/reseller\nCode: ${result.reseller.code}\nUsername: ${result.reseller.username}\nAPI key: ${result.reseller.apiKey}`); form.reset();
    } catch (error) { toast(error.message, true); } finally { busy(form, false); }
  });
  $("dealerLogout")?.addEventListener("click", () => { STATE.auth = null; saveAuth(); showAuth("Logged out. Session credentials removed."); });
  $("dealerRefresh")?.addEventListener("click", () => loadDashboard().then(() => toast("Dashboard refreshed")).catch((error) => toast(error.message, true)));
  for (const id of ["dealerClientSearch", "dealerClientStatus", "dealerClientSort"]) $(id)?.addEventListener(id === "dealerClientSearch" ? "input" : "change", renderClients);
  $("clientCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    try {
      const result = await api("reseller/client-create", { name: $("clientName").value.trim(), username: $("clientUsername").value.trim() || undefined, password: $("clientPassword").value || undefined, whatsapp: $("clientWhatsapp").value.trim(), planId: $("clientPlan").value, devices: Number($("clientDevices").value || 1), mac: $("clientMac").value.trim(), collectAmount: Number($("clientAmount").value || 0), via: $("clientVia").value });
      const c = result.client;
      showCredentials("Client provisioned — share credentials securely", `Server: ${location.origin}\nUsername: ${c.username}\nPassword: ${c.password}\nM3U: ${result.links.m3u}\nEPG: ${result.links.epg}${result.stalker ? `\nMAG portal: ${result.stalker.portalUrl}\nMAC: ${result.stalker.mac}` : ""}`);
      toast(`✅ ${c.username} created · ${result.creditsLeft} credits left`); form.reset(); $("clientDevices").value = 1; await loadDashboard();
    } catch (error) { toast(error.message, true); } finally { busy(form, false); }
  });
  $("pricingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); busy(event.currentTarget, true);
    try { await api("reseller/pricing-set", { pricing: { monthly: Number($("priceMonthly").value || 0), quarterly: Number($("priceQuarterly").value || 0), yearly: Number($("priceYearly").value || 0), connectionFee: Number($("priceConnection").value || 0) } }); toast("💰 Selling prices saved"); await loadDashboard(); }
    catch (error) { toast(error.message, true); } finally { busy(event.currentTarget, false); }
  });
  $("accountForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    try {
      const result = await api("reseller/profile-update", { username: $("accountUsername").value.trim(), name: $("accountName").value.trim(), whatsapp: $("accountWhatsapp").value.trim(), currentPassword: $("accountCurrentPassword").value, newPassword: $("accountNewPassword").value || undefined, confirmPassword: $("accountConfirmPassword").value || undefined });
      toast(result.note || "Account saved"); $("accountCurrentPassword").value = ""; $("accountNewPassword").value = ""; $("accountConfirmPassword").value = ""; await loadDashboard();
    } catch (error) { toast(error.message, true); } finally { busy(form, false); }
  });
  $("brandingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    try {
      await api("reseller/profile-update", { branding: { paymentMethod: $("brandMethod").value.trim(), paymentAccount: $("brandAccount").value.trim(), paymentTitle: $("brandTitle").value.trim(), tagline: $("brandTagline").value.trim() } });
      toast("🎬 Branded intro details saved"); await loadDashboard();
    } catch (error) { toast(error.message, true); } finally { busy(form, false); }
  });
  $("paymentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true);
    try { const result = await api("reseller/payment-record", { username: $("paymentUsername").value.trim(), amount: Number($("paymentAmount").value || 0), months: Number($("paymentMonths").value || 0), via: $("paymentVia").value }); toast(`🧾 Payment recorded · ${result.creditsLeft} credits left`); form.reset(); await loadDashboard(); }
    catch (error) { toast(error.message, true); } finally { busy(form, false); }
  });
  $("rotateKeyBtn")?.addEventListener("click", async () => {
    if (!confirm("Rotate API key? Your old mzr_ key will stop working immediately.")) return;
    try { const result = await api("reseller/key-rotate"); if (!STATE.auth?.resellerToken) await loginWith({ apiKey: result.apiKey }); saveAuth(); showCredentials("New API key — old key is now invalid", result.apiKey); toast("🔑 API key rotated"); }
    catch (error) { toast(error.message, true); }
  });
  function closeClientEdit() { const dialog = $("clientEditDialog"); if (dialog?.open) dialog.close(); }
  function openClientEdit(client) {
    $("editClientOriginal").value = client.username; $("editClientUsername").value = client.username;
    $("editClientName").value = client.name || ""; $("editClientWhatsapp").value = client.whatsapp || "";
    $("editClientMac").value = client.mac || ""; $("editClientDevices").value = client.devices || 1; $("editClientPassword").value = "";
    setText("clientEditError", ""); $("clientEditDialog").showModal();
  }
  $("clientEditClose")?.addEventListener("click", closeClientEdit);
  $("clientEditCancel")?.addEventListener("click", closeClientEdit);
  $("clientEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; busy(form, true); setText("clientEditError", "");
    try {
      const payload = { username: $("editClientOriginal").value, newUsername: $("editClientUsername").value.trim(), name: $("editClientName").value.trim(), whatsapp: $("editClientWhatsapp").value.trim(), mac: $("editClientMac").value.trim(), devices: Number($("editClientDevices").value || 1) };
      if ($("editClientPassword").value) payload.password = $("editClientPassword").value;
      const result = await api("reseller/client-update", payload); closeClientEdit(); toast("Client updated — old playlist links may need replacing"); await loadDashboard();
      const credentials = await api("reseller/credentials", { username: result.client.username }); const c = credentials.credentials;
      showCredentials(`Updated credentials · ${c.username}`, `Server: ${c.serverUrl}\nUsername: ${c.username}\nPassword: ${c.password}\nM3U: ${c.m3u}\nEPG: ${c.epg}${c.mac ? `\nMAG portal: ${c.magPortal}\nMAC: ${c.mac}` : ""}`);
    } catch (error) { setText("clientEditError", error.message); } finally { busy(form, false); }
  });
  document.addEventListener("click", async (event) => {
    if (event.target.closest("#copyDealerCredentials")) { toast(await copyText(STATE.credentials) ? "Credentials copied" : "Clipboard unavailable"); return; }
    const button = event.target.closest("[data-dealer-edit],[data-dealer-cred],[data-dealer-renew],[data-dealer-toggle],[data-dealer-pay],[data-dealer-del]"); if (!button) return;
    try {
      if (button.dataset.dealerEdit) { const client = STATE.clients.find((c) => c.username === button.dataset.dealerEdit); if (client) openClientEdit(client); return; }
      if (button.dataset.dealerPay) { $("paymentUsername").value = button.dataset.dealerPay; $("paymentForm").scrollIntoView({ behavior: "smooth", block: "center" }); $("paymentAmount").focus(); return; }
      if (button.dataset.dealerCred) {
        const result = await api("reseller/credentials", { username: button.dataset.dealerCred }); const c = result.credentials;
        showCredentials(`Credentials · ${c.username}`, `Server: ${c.serverUrl}\nUsername: ${c.username}\nPassword: ${c.password}\nM3U: ${c.m3u}\nEPG: ${c.epg}${c.mac ? `\nMAG portal: ${c.magPortal}\nMAC: ${c.mac}` : ""}`); return;
      }
      if (button.dataset.dealerRenew) { if (!confirm(`Renew ${button.dataset.dealerRenew} for one month using 1 credit?`)) return; const result = await api("reseller/client-renew", { username: button.dataset.dealerRenew, planId: "monthly" }); toast(`🔄 Renewed · ${result.creditsLeft} credits left`); await loadDashboard(); return; }
      if (button.dataset.dealerToggle) { const active = button.dataset.dealerActive === "true"; await api("reseller/client-suspend", { username: button.dataset.dealerToggle, suspended: active }); toast(active ? "⏸ Client suspended" : "▶ Client activated"); await loadDashboard(); return; }
      if (button.dataset.dealerDel) { if (!confirm(`Permanently delete ${button.dataset.dealerDel}?`)) return; await api("reseller/client-delete", { username: button.dataset.dealerDel }); toast("Client deleted"); await loadDashboard(); }
    } catch (error) { toast(error.message, true); }
  });
  (async function boot() {
    loadAuth(); if (!STATE.auth) { showAuth(); return; }
    try { await loadDashboard(); } catch (error) { STATE.auth = null; saveAuth(); showAuth("Session expired. Please login again."); toast(error.message, true); }
  })();
})();
