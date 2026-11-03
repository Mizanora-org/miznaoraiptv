/** Mizanora IPTV — functional owner admin panel. */
import {
  subscribeAuth, loginWithGoogle, loginWithGoogleRedirect, finishRedirect,
  logoutUser, getFirebaseIdToken, isAdminEmail, ADMIN_EMAIL
} from "/assets/js/firebase-client.js?v=6.0.0";

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { const el = $(id); if (el) el.textContent = String(value ?? ""); };
const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safe = (name, fn) => {
  try {
    const result = fn();
    if (result?.catch) result.catch((error) => console.error(`[${name}]`, error));
    return result;
  } catch (error) { console.error(`[${name}]`, error); return undefined; }
};
function toast(message, tone = "ok") {
  const box = $("toasts");
  if (!box) return;
  const item = document.createElement("div");
  item.className = "toast" + (tone === "error" ? " err" : "");
  item.textContent = String(message);
  box.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}
const debounce = (fn, wait = 220) => {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(fn, wait); };
};

const STATE = {
  user: null, tab: "dashboard", global: "", loaded: false, entering: null,
  filters: { channels: "", xtream: "", users: "", resellers: "" }, catalog: { movies: { offset: 0, total: 0 }, series: { offset: 0, total: 0 } },
  channels: [], playlists: [], xtream: [], movies: [], series: [],
  clients: [], resellers: [], orders: [], stalker: [], keys: [], audit: [], epgSources: []
};
const TAB_VIEWS = {
  dashboard: "viewDashboard", studio: "viewStudio", channels: "viewChannels", playlists: "viewPlaylists", epg: "viewEpg",
  xtream: "viewXtream", movies: "viewMovies", series: "viewSeries",
  analytics: "viewAnalytics", users: "viewUsers", settings: "viewSettings",
  resellers: "viewResellers", orders: "viewOrders", stalker: "viewStalker", apikeys: "viewApiKeys", academy: "viewAcademy"
};
const TAB_TITLES = {
  studio: ["Broadcast Studio", "Preview, inspect and control your channel playout"],
  dashboard: ["📊 Dashboard", "Real-time IPTV server overview"],
  channels: ["📺 Channel Manager", "Add, edit and remove live channels"],
  playlists: ["📋 Playlists", "Cloud M3U playlists and import history"],
  epg: ["🗓️ EPG Manager", "XMLTV sources, programmes and public TV guide"],
  xtream: ["⚡ Xtream Accounts", "Create, renew, suspend and delete users"],
  movies: ["🎬 Movies", "Search the full IMDb catalog and configure playback"],
  series: ["📺 Series", "IMDb series and episode catalog"],
  analytics: ["📈 Live Analytics", "Visitors, sessions, plays and client errors"],
  users: ["👤 Users", "Panel clients and subscription status"],
  settings: ["⚙️ Settings", "Videos, WhatsApp and announcement"],
  resellers: ["🏪 Resellers", "Dealers, credits and top-up"],
  orders: ["🧾 Orders", "Approve once to auto-provision Xtream"],
  stalker: ["🛰️ Stalker / MAG", "MAC-bound clients and portal URL"],
  apikeys: ["🔑 API Keys", "Create and revoke owner API keys"],
  academy: ["🎓 IPTV Academy", "Owner operations, reseller business and setup training"]
};

/* ---------- auth + API ---------- */
function adminToken() {
  try {
    const raw = localStorage.getItem("mz_admin_session");
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || Date.now() > Number(session.expiresAt || 0)) {
      localStorage.removeItem("mz_admin_session");
      return null;
    }
    return session.token;
  } catch { return null; }
}
async function authHeaders(extra = {}) {
  const headers = { ...extra };
  const pin = adminToken();
  if (pin) headers["x-admin-token"] = pin;
  else {
    const idToken = await getFirebaseIdToken().catch(() => null);
    if (idToken) headers.Authorization = "Bearer " + idToken;
  }
  try {
    const key = localStorage.getItem("mz_admin_key");
    if (key) headers["x-api-key"] = key;
  } catch { /* storage can be unavailable in strict privacy mode */ }
  return headers;
}
async function apiRequest(action, { method = "GET", params = {}, payload } = {}) {
  const query = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, value);
  const response = await fetch(method === "GET" ? "/api/panel?" + query : "/api/panel?action=" + encodeURIComponent(action), {
    method, headers: await authHeaders(method === "POST" ? { "Content-Type": "application/json" } : {}),
    body: method === "POST" ? JSON.stringify({ action, ...(payload || {}) }) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && action !== "admin/pin-login" && adminToken()) {
      try { localStorage.removeItem("mz_admin_session"); } catch {}
      STATE.loaded = false;
      showLock("Owner session expire ho gaya — dobara unlock karein.");
    }
    throw new Error(data.error || `API ${action} failed (${response.status})`);
  }
  return data;
}
const apiGet = (action, params = {}) => apiRequest(action, { params });
const apiPost = (action, payload = {}) => apiRequest(action, { method: "POST", payload });

/* ---------- lock ---------- */
function lockErr(message) { setText("lockErr", message || ""); }
function showLock(message) {
  $("adminLock")?.classList.add("show");
  document.body.classList.add("is-locked");
  document.body.classList.remove("unlocked");
  lockErr(message || "");
}
function hideLock() {
  $("adminLock")?.classList.remove("show");
  document.body.classList.remove("is-locked");
  document.body.classList.add("unlocked");
}
function paintUser() {
  const user = STATE.user;
  if (!user) return;
  setText("userName", user.displayName || user.email || "Admin");
  setText("userRole", isAdminEmail(user.email) ? "Super Admin (Owner)" : "Admin");
  setText("userAvatar", (user.displayName || user.email || "A").slice(0, 2).toUpperCase());
}
async function enterAdmin(user) {
  STATE.user = user;
  paintUser();
  hideLock();
  appInit();
  if (!STATE.loaded) {
    if (!STATE.entering) STATE.entering = loadAll().finally(() => { STATE.entering = null; });
    await STATE.entering;
  }
  switchTab(STATE.tab || "dashboard");
}
async function onAuthUser(user) {
  if (user) {
    if (!isAdminEmail(user.email)) {
      showLock(`⛔ Access denied — ye panel sirf ${ADMIN_EMAIL} ke liye hai.`);
      await logoutUser();
      try { localStorage.removeItem("mz_admin_session"); } catch {}
      return;
    }
    await enterAdmin({ displayName: user.displayName || user.email, email: user.email, uid: user.uid });
  } else if (!adminToken()) {
    STATE.loaded = false;
    showLock();
    setText("userName", "🔒 Locked");
    setText("userRole", "Google owner login ya Owner PIN required");
    setText("userAvatar", "🔒");
  }
}
async function pinLogin(pin) {
  if (!pin) return lockErr("Enter the Owner PIN.");
  const button = $("lockPinBtn");
  if (button) button.disabled = true;
  lockErr("");
  try {
    const result = await apiPost("admin/pin-login", { pin });
    localStorage.setItem("mz_admin_session", JSON.stringify({ token: result.token, expiresAt: Date.now() + (result.expiresIn || 43200) * 1000 }));
    if ($("lockPinIn")) $("lockPinIn").value = "";
    await enterAdmin({ displayName: "Owner (PIN)", email: ADMIN_EMAIL, uid: "owner_pin" });
    toast("👑 Owner access granted");
  } catch (error) {
    lockErr(error.message);
    toast(error.message, "error");
  } finally { if (button) button.disabled = false; }
}

/* ---------- navigation ---------- */
function switchTab(tab) {
  if (STATE.tab === "studio" && tab !== "studio") stopStudio();
  if (!TAB_VIEWS[tab]) tab = "dashboard";
  STATE.tab = tab;
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll("section[id^=view]").forEach((section) => { section.hidden = section.id !== TAB_VIEWS[tab]; });
  const [title, subtitle] = TAB_TITLES[tab];
  setText("pageTitle", title.replace(/^[^A-Za-z]+/, ""));
  if (tab === "epg") safe("epgMapping", loadEpgMapping);
  if (tab === "academy") window.MizanoraAcademy?.mountAll();
  setText("pageSub", subtitle);
}

/* ---------- loading + rendering ---------- */
let loadingPromise = null;
async function loadAll() {
  if (loadingPromise) return loadingPromise;
  const refresh = $("btnRefresh");
  if (refresh) refresh.disabled = true;
  loadingPromise = (async () => {
    const jobs = [loadSystemHealth, loadChannels, loadPlaylists, loadEpgSources, loadXtream, loadMovies, loadSeries, loadUsers, loadSettings, loadAnalytics, loadResellers, loadOrders, loadStalker, loadApiKeys, loadAudit];
    const results = await Promise.allSettled(jobs.map((job) => job()));
    const failed = results.filter((result) => result.status === "rejected");
    STATE.loaded = true;
    if (failed.length) {
      setText("kpiSystem", "Degraded");
      setText("kpiSysSub", `${failed.length} section${failed.length > 1 ? "s" : ""} failed`);
      toast(`${failed.length} panel section(s) load nahi hue: ${failed[0].reason?.message || "API error"}`, "error");
    }
    return { failed: failed.length };
  })().finally(() => {
    loadingPromise = null;
    if (refresh) refresh.disabled = false;
  });
  return loadingPromise;
}
function queryFor(name) { return String(STATE.global || STATE.filters[name] || "").trim().toLowerCase(); }
function matches(item, query, fields) {
  if (!query) return true;
  return fields.some((field) => String(item?.[field] ?? "").toLowerCase().includes(query));
}
async function loadSystemHealth() {
  const response = await fetch("/api/embed?action=health");
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error("System health check failed");
  setText("kpiSystem", "Online");
  const storage = data.storage || {};
  setText("kpiSysSub", storage.durableServerWrites ? "Firebase persistent storage" : storage.production ? "⚠ Firebase service account required" : "Local development mirror");
}
async function loadChannels() {
  const data = await apiGet("admin/channels");
  STATE.channels = data.channels || [];
  if ($("studioChannel")) { const selected = $("studioChannel").value; $("studioChannel").innerHTML = '<option value="">Choose a live channel…</option>' + STATE.channels.filter(c => c.status !== "inactive").map(c => `<option value="${esc(c.id)}">#${esc(c.channelNumber || c.streamId || "")} ${esc(c.name)}</option>`).join(""); $("studioChannel").value = selected; }
  const categoryFilter = $("chCategoryFilter");
  if (categoryFilter) { const selected = categoryFilter.value; categoryFilter.innerHTML = '<option value="">All categories</option>' + [...new Set(STATE.channels.map(c => c.category).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join(""); categoryFilter.value = selected; }
  setText("badgeChannels", STATE.channels.length);
  setText("kpiChannels", STATE.channels.length);
  const pro = STATE.channels.filter((c) => c.tier === "pro").length;
  setText("kpiChannelsSub", `${STATE.channels.length - pro} Free • ${pro} PRO`);
  renderChannels();
}
function renderChannels() {
  const body = $("chBody");
  if (!body) return;
  const query = queryFor("channels");
  let list = STATE.channels.filter((c) => matches(c, query, ["name", "category", "url", "id", "epgId", "channelNumber", "streamId"]));
  const category = $("chCategoryFilter")?.value || "", access = $("chAccessFilter")?.value || "";
  list = list.filter((c) => (!category || c.category === category) && (!access || c.tier === access));
  const mode = $("chSort")?.value || "order";
  const text = (v) => String(v || "").toLowerCase();
  list = [...list].sort((a, b) => mode === "number-asc" ? a.channelNumber - b.channelNumber : mode === "number-desc" ? b.channelNumber - a.channelNumber : mode === "name-asc" ? text(a.name).localeCompare(text(b.name)) : mode === "name-desc" ? text(b.name).localeCompare(text(a.name)) : mode === "category-asc" ? text(a.category).localeCompare(text(b.category)) || a.channelNumber - b.channelNumber : mode === "epg-first" ? Number(!!b.epgId) - Number(!!a.epgId) || a.channelNumber - b.channelNumber : 0);
  body.innerHTML = list.map((channel) => {
    const index = STATE.channels.indexOf(channel) + 1;
    return `<tr data-row><td><button class="number-chip" data-ch-edit="${esc(channel.id)}" title="Edit channel number">#${Number(channel.channelNumber) || index}</button><span class="cell-sub mono">ID ${esc(channel.streamId || "—")}</span></td><td>${channel.logo ? `<img src="${esc(channel.logo)}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : "📺"}</td><td><b>${esc(channel.name)}</b><br><span class="cell-sub mono">${esc(channel.url || "")}</span><span class="cell-sub">EPG: ${esc(channel.epgId || "not mapped")}</span></td><td>${esc(channel.category || "")}</td><td><span class="pill ${channel.status === "offline" ? "bad" : channel.status === "inactive" ? "warn" : "ok"}">${esc(channel.status || "active")}</span> <span class="pill ${channel.tier === "pro" ? "warn" : "ok"}">${channel.tier === "pro" ? "PRO" : "FREE"}</span></td><td class="actions"><button class="btn btn-ghost btn-sm" data-ch-move="${esc(channel.id)}" data-direction="-1" title="Move up" ${index === 1 ? "disabled" : ""}>↑</button><button class="btn btn-ghost btn-sm" data-ch-move="${esc(channel.id)}" data-direction="1" title="Move down" ${index === STATE.channels.length ? "disabled" : ""}>↓</button><button class="btn btn-ghost btn-sm" data-ch-check="${esc(channel.id)}" title="Check upstream source">🩺</button><button class="btn btn-ghost btn-sm" data-ch-edit="${esc(channel.id)}" title="Edit channel">✏️</button><button class="btn btn-danger btn-sm" data-ch-del="${esc(channel.id)}" title="Delete channel">🗑</button></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No matching channels.</td></tr>';
}
async function loadPlaylists() {
  const data = await apiGet("admin/playlists");
  STATE.playlists = data.playlists || [];
  setText("badgePlaylists", STATE.playlists.length);
  setText("kpiPlaylists", STATE.playlists.length);
  const body = $("plBody");
  if (!body) return;
  body.innerHTML = STATE.playlists.map((p) => `<tr data-row><td><b>${esc(p.name || "Playlist")}</b><br><span class="cell-sub mono">${esc(p.url || "")}</span></td><td>${esc(p.type || "m3u")}</td><td>${esc(String(p.updatedAt || "").replace("T", " ").slice(0, 19) || "—")}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-pl-edit="${esc(p.id)}">✏️</button><button class="btn btn-danger btn-sm" data-pl-del="${esc(p.id)}">🗑</button></td></tr>`).join("") || '<tr><td colspan="4" class="empty">No playlists yet. Add one above.</td></tr>';
}
async function loadEpgSources() {
  const data = await apiGet("admin/epg-sources");
  STATE.epgSources = data.sources || [];
  setText("badgeEpg", STATE.epgSources.length);
  const body = $("epgBody");
  if (!body) return;
  body.innerHTML = STATE.epgSources.map((source) => `<tr><td><b>${esc(source.name || source.id)}</b><span class="cell-sub mono">${esc(source.url || "Uploaded file")}</span></td><td>${Number(source.channelCount || 0)}</td><td>${Number(source.programmeCount || 0)}</td><td>${esc(String(source.updatedAt || "").replace("T", " ").slice(0, 19))}</td><td class="actions">${source.url ? `<button class="btn btn-ghost btn-sm" data-epg-refresh="${esc(source.id)}" title="Refresh remote EPG">↻</button>` : ""}<button class="btn btn-danger btn-sm" data-epg-delete="${esc(source.id)}" title="Delete source">🗑</button></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No EPG sources. Import XMLTV above.</td></tr>';
}
async function loadEpgMapping() {
  const data = await apiGet("admin/epg-mapping");
  const channels = data.channels || [], sources = data.sources || [];
  const mapped = channels.filter((c) => c.mapped).length;
  setText("epgCoverage", `${mapped}/${channels.length} channels mapped · ${sources.length} XMLTV channel IDs · times shown in your browser timezone`);
  const body = $("epgMapBody");
  if (!body) return;
  body.innerHTML = channels.map((channel) => `<tr><td><b>#${Number(channel.channelNumber)} ${esc(channel.name)}</b><span class="cell-sub">${esc(channel.epgId || "Not mapped")}</span></td><td><select data-epg-channel="${esc(channel.id)}" aria-label="XMLTV mapping for ${esc(channel.name)}"><option value="">Not mapped</option>${sources.map((source) => `<option value="${esc(source.id)}" ${source.id === channel.epgId ? "selected" : ""}>${esc(source.name)} · ${esc(source.id)}</option>`).join("")}${channel.epgId && !sources.some((s) => s.id === channel.epgId) ? `<option value="${esc(channel.epgId)}" selected>${esc(channel.epgId)} (external ID)</option>` : ""}</select></td><td>${Number(channel.programmeCount || 0)}</td><td><button class="btn btn-primary btn-sm" data-epg-save="${esc(channel.id)}">Save mapping</button></td></tr>`).join("") || '<tr><td colspan="4" class="empty">Add channels and import XMLTV to begin.</td></tr>';
}
async function loadXtream() {
  const data = await apiGet("admin/xtream-accounts");
  STATE.xtream = data.accounts || [];
  setText("badgeXtream", STATE.xtream.length);
  setText("kpiXtream", STATE.xtream.length);
  const active = STATE.xtream.filter((a) => String(a.status).toLowerCase() === "active" && !(Number(a.expDate) < Date.now() / 1000)).length;
  setText("kpiXtreamSub", `${active} Active • ${STATE.xtream.length - active} inactive`);
  renderXtream();
}
function renderXtream() {
  const body = $("xtBody");
  if (!body) return;
  const query = queryFor("xtream");
  const list = STATE.xtream.filter((a) => matches(a, query, ["username", "mac", "displayName", "resellerCode"]));
  body.innerHTML = list.map((account) => {
    const expired = Number(account.expDate || 0) > 0 && Number(account.expDate) < Date.now() / 1000;
    const active = String(account.status || "Active").toLowerCase() === "active" && !expired;
    const status = expired ? '<span class="pill warn">Expired</span>' : active ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>';
    const expiry = account.expDate ? new Date(Number(account.expDate) * 1000).toLocaleDateString() : "—";
    return `<tr data-row><td><b>${esc(account.username)}</b><br><span class="cell-sub">${esc(account.resellerCode || "direct")}</span></td><td class="mono">${esc(account.password)}</td><td class="mono">${esc(account.mac || "—")}</td><td>${status}</td><td>${expiry}</td><td class="actions"><button class="btn btn-ghost btn-sm" data-xt-edit="${esc(account.username)}" title="Edit username / password">✏️</button><button class="btn btn-ghost btn-sm" data-xt-renew="${esc(account.username)}" title="Renew">🔄</button><button class="btn btn-ghost btn-sm" data-xt-toggle="${esc(account.username)}" data-xt-active="${active}" title="${active ? "Suspend" : "Activate"}">${active ? "⏸" : "▶️"}</button><button class="btn btn-danger btn-sm" data-xt-del="${esc(account.username)}" title="Delete">🗑</button></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No matching Xtream accounts.</td></tr>';
}
let movieRequest = 0, seriesRequest = 0;
async function loadMovies() {
  const request = ++movieRequest;
  const query = STATE.global || STATE.filters.movies || "";
  const page = STATE.catalog.movies;
  const params = new URLSearchParams({ action: "movies", limit: "80", offset: String(page.offset), q: query, sort: $("mvSort")?.value || "title-asc", category: $("mvCategory")?.value || "", ready: $("mvReady")?.checked ? "1" : "" });
  const response = await fetch("/api/embed?" + params);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Movies failed to load");
  if (request !== movieRequest) return;
  STATE.movies = data.movies || [];
  page.total = Number(data.total || 0);
  fillCategoryFilter("mvCategory", data.categories || []);
  setText("mvPageInfo", `${page.total ? page.offset + 1 : 0}–${Math.min(page.offset + 80, page.total)} of ${page.total}`);
  if ($("mvPrev")) $("mvPrev").disabled = page.offset === 0;
  if ($("mvNext")) $("mvNext").disabled = page.offset + 80 >= page.total;
  renderMovies();
}
function fillCategoryFilter(id, categories) {
  const select = $(id); if (!select) return;
  const value = select.value;
  select.innerHTML = '<option value="">All categories</option>' + categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value = value;
}
function sortCatalog(items, selectId) {
  const mode = $(selectId)?.value || "title-asc";
  return [...items].sort((a, b) => {
    if (mode === "title-desc") return String(b.title || "").localeCompare(String(a.title || ""));
    if (mode === "year-desc") return (Number(b.year) || 0) - (Number(a.year) || 0) || String(a.title || "").localeCompare(String(b.title || ""));
    if (mode === "year-asc") return (Number(a.year) || 0) - (Number(b.year) || 0) || String(a.title || "").localeCompare(String(b.title || ""));
    if (mode === "rating-desc") return (Number(b.rating) || 0) - (Number(a.rating) || 0) || String(a.title || "").localeCompare(String(b.title || ""));
    if (mode === "ready-first") return Number(Boolean(b.streamAvailable)) - Number(Boolean(a.streamAvailable)) || String(a.title || "").localeCompare(String(b.title || ""));
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}
function renderMovies() {
  const body = $("mvBody");
  if (!body) return;
  body.innerHTML = sortCatalog(STATE.movies, "mvSort").map((m) => `<tr data-row><td><b>${esc(m.title)}</b><br><span class="cell-sub">${esc(m.category || "")}</span></td><td>${esc(m.year || "—")}</td><td>⭐ ${esc(m.rating || "—")}</td><td>${m.streamAvailable ? '<span class="pill ok">Ready</span>' : '<span class="pill warn">Metadata only</span>'}</td><td><button class="btn btn-ghost btn-sm" data-mv-stream="${esc(m.id)}" title="Set licensed stream URL">🔗 Stream URL</button></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No matching movies.</td></tr>';
}
async function loadSeries() {
  const request = ++seriesRequest;
  const query = STATE.global || STATE.filters.series || "";
  const page = STATE.catalog.series;
  const params = new URLSearchParams({ action: "series", limit: "80", offset: String(page.offset), q: query, sort: $("srSort")?.value || "title-asc", category: $("srCategory")?.value || "", ready: $("srReady")?.checked ? "1" : "" });
  const response = await fetch("/api/embed?" + params);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Series failed to load");
  if (request !== seriesRequest) return;
  STATE.series = data.series || [];
  page.total = Number(data.total || 0);
  fillCategoryFilter("srCategory", data.categories || []);
  setText("srPageInfo", `${page.total ? page.offset + 1 : 0}–${Math.min(page.offset + 80, page.total)} of ${page.total}`);
  if ($("srPrev")) $("srPrev").disabled = page.offset === 0;
  if ($("srNext")) $("srNext").disabled = page.offset + 80 >= page.total;
  const body = $("srBody");
  if (!body) return;
  body.innerHTML = sortCatalog(STATE.series, "srSort").map((s) => `<tr data-row><td><b>${esc(s.title)}</b><br><span class="cell-sub">${esc(s.category || "")}</span></td><td>${esc(s.year || "—")}</td><td>⭐ ${esc(s.rating || "—")}</td><td>${Number(s.episodeCount || 0)}</td><td>${s.streamAvailable ? '<span class="pill ok">Ready</span>' : '<span class="pill warn">Metadata only</span>'}</td><td><button class="btn btn-ghost btn-sm" data-sr-episodes="${esc(s.id)}" title="Configure episode stream">🔗 Episodes</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No matching series.</td></tr>';
}
async function loadUsers() {
  const data = await apiGet("admin/clients");
  STATE.clients = data.clients || [];
  renderUsers();
}
function renderUsers() {
  const body = $("usBody");
  if (!body) return;
  const query = queryFor("users");
  const list = STATE.clients.filter((c) => matches(c, query, ["username", "whatsapp", "email", "resellerCode", "name"]));
  body.innerHTML = list.map((c) => {
    const status = c.status === "suspended" ? '<span class="pill bad">Suspended</span>' : c.expired ? '<span class="pill warn">Expired</span>' : '<span class="pill ok">Active</span>';
    return `<tr data-row><td><b>${esc(c.username)}</b></td><td>${esc(c.whatsapp || "—")}</td><td>${esc(c.resellerCode || "direct")}</td><td>${status}</td><td>${Number(c.daysLeft || 0)} <button class="btn btn-ghost btn-sm" data-user-copy="${esc(c.username)}" title="Copy credentials">📋</button></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="empty">No matching clients.</td></tr>';
}
async function loadSettings() {
  const data = await apiGet("admin/settings");
  const settings = data.settings || {};
  if ($("stServerlessHls")) $("stServerlessHls").checked = settings.serverlessHlsEnabled !== false;
  setText("studioEngine", settings.serverlessHlsEnabled !== false ? "● Vercel HLS enabled" : "○ Direct-source mode");
  const map = { stWelcome: "welcomeVideoUrl", stOffline: "channelOfflineVideoUrl", stComing: "comingSoonVideoUrl", stPro: "proUnlockVideoUrl", stWa: "proWhatsapp", stWaIntl: "proWhatsappIntl", stTicker: "siteAnnouncement", stWelcomeDuration: "welcomeDurationSec", stRechargeNote: "rechargeNote", stResellerNote: "resellerContactNote", stPaymentMethod: "paymentMethod", stPaymentAccount: "paymentAccountNumber", stPaymentTitle: "paymentAccountTitle", stBusinessIntro: "businessIntroText" };
  for (const [id, key] of Object.entries(map)) if ($(id)) $(id).value = settings[key] || "";
  if ($("stWelcomeEnabled")) $("stWelcomeEnabled").checked = settings.welcomeVideoEnabled !== false;
  if ($("stWelcomeSkippable")) $("stWelcomeSkippable").checked = settings.welcomeSkippable === true;
  if ($("stProEnabled")) $("stProEnabled").checked = settings.proUnlockVideoEnabled !== false;
  if ($("introPreview") && settings.welcomeVideoUrl) $("introPreview").src = settings.welcomeVideoUrl;
}
async function loadAnalytics() {
  const [data, errors] = await Promise.all([apiGet("admin/analytics"), apiGet("admin/errors", { limit: 20 })]);
  const analytics = data.analytics || {};
  setText("anOnline", analytics.onlineNow ?? 0);
  setText("anSessions", analytics.totalSessions ?? 0);
  setText("anPlays", analytics.totalPlays ?? 0);
  setText("anAvg", Math.round((analytics.avgSessionSec || 0) / 60) + " min");
  const sessions = analytics.recentSessions || [];
  if ($("sessBody")) $("sessBody").innerHTML = sessions.map((s) => `<tr><td class="mono">${esc(s.id || "—")}</td><td>${esc(s.event || "page_view")}</td><td>${esc(s.route || "—")}</td><td>${esc(s.lastSeenAt || s.at || "—")}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No tracked sessions yet.</td></tr>';
  if ($("errBody")) $("errBody").innerHTML = (errors.errors || []).map((e) => `<tr><td class="mono">${esc(e.message)}</td><td>${esc(e.route || "")}</td><td>${esc(e.at || "")}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">No errors 🎉</td></tr>';
}
async function loadResellers() {
  const data = await apiGet("admin/resellers");
  STATE.resellers = data.resellers || [];
  renderResellers();
}
function renderResellers() {
  const body = $("rsBody");
  if (!body) return;
  const query = queryFor("resellers");
  const list = STATE.resellers.filter((r) => matches(r, query, ["code", "name", "email", "whatsapp"]));
  body.innerHTML = list.map((r) => `<tr data-row><td class="mono"><b>${esc(r.code)}</b><span class="cell-sub">@${esc(r.username || r.code.toLowerCase())}</span></td><td>${esc(r.name || "")}<br><span class="cell-sub">${esc(r.email || "")}</span></td><td>${Number(r.credits || 0)}</td><td>${r.status === "suspended" ? '<span class="pill bad">Suspended</span>' : '<span class="pill ok">Active</span>'}</td><td class="actions"><button class="btn btn-primary btn-sm" data-rs-topup="${esc(r.code)}">＋ Credits</button> <button class="btn btn-ghost btn-sm" data-rs-edit="${esc(r.code)}">✏️ Login</button> <button class="btn btn-ghost btn-sm" data-rs-report="${esc(r.code)}">Report</button> <button class="btn btn-ghost btn-sm" data-rs-toggle="${esc(r.code)}" data-rs-suspended="${r.status === "suspended"}">${r.status === "suspended" ? "Activate" : "Suspend"}</button></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No matching resellers.</td></tr>';
}
async function loadOrders() {
  const data = await apiGet("admin/orders");
  STATE.orders = data.orders || [];
  const body = $("orBody");
  if (!body) return;
  body.innerHTML = STATE.orders.map((o) => {
    const status = o.status === "approved" ? '<span class="pill ok">Approved</span>' : o.status === "rejected" ? '<span class="pill bad">Rejected</span>' : '<span class="pill warn">Pending</span>';
    const action = o.status === "pending" ? `<button class="btn btn-primary btn-sm" data-or-approve="${esc(o.id)}" title="Approve and provision">✅</button> <button class="btn btn-danger btn-sm" data-or-reject="${esc(o.id)}" title="Reject">✖</button>` : esc(o.clientUsername || "—");
    return `<tr data-row><td class="mono">${esc(o.id)}</td><td>${esc(o.name)}<br><span class="cell-sub">${esc(o.whatsapp || "")}</span></td><td>${esc(o.planId)}</td><td>Rs ${Number(o.amount || 0)}</td><td>${status}</td><td>${action}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">No orders.</td></tr>';
}
async function loadStalker() {
  const data = await apiGet("admin/stalker/list");
  STATE.stalker = data.clients || [];
  setText("portalUrl", location.origin + "/portal.php");
  const body = $("stBody");
  if (!body) return;
  body.innerHTML = STATE.stalker.map((c) => `<tr data-row><td class="mono">${esc(c.mac)}</td><td>${esc(c.username)}</td><td>${c.status === "suspended" || c.expired ? '<span class="pill bad">Blocked</span>' : '<span class="pill ok">Active</span>'}</td><td>${c.expDate ? new Date(Number(c.expDate) * 1000).toLocaleDateString() : "—"}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No MAG clients yet. Create an Xtream user with a MAC address.</td></tr>';
}
async function loadApiKeys() {
  const data = await apiGet("admin/api-keys");
  STATE.keys = data.keys || [];
  const body = $("keyBody");
  if (!body) return;
  body.innerHTML = STATE.keys.map((k) => `<tr data-row><td>${esc(k.label)}</td><td>${esc(String(k.createdAt || "").slice(0, 10))}</td><td>${esc(k.lastUsedAt ? new Date(Number(k.lastUsedAt)).toLocaleString() : "—")}</td><td>${k.revoked ? '<span class="pill bad">Revoked</span>' : '<span class="pill ok">Active</span>'}</td><td>${k.revoked ? "" : `<button class="btn btn-danger btn-sm" data-key-revoke="${esc(k.id)}">Revoke</button>`}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">No API keys.</td></tr>';
}
async function loadAudit() {
  const data = await apiGet("admin/audit", { limit: 12 });
  STATE.audit = data.audit || [];
  if ($("actBody")) $("actBody").innerHTML = STATE.audit.map((a) => `<tr><td class="cell-sub">${esc(String(a.at || "").slice(0, 19).replace("T", " "))}</td><td>${esc(a.action)}</td><td class="mono cell-sub">${esc(JSON.stringify(a.detail || {}).slice(0, 90))}</td></tr>`).join("") || '<tr><td class="empty">No activity.</td></tr>';
}
function renderLocalSearches() { renderChannels(); renderXtream(); renderUsers(); renderResellers(); }
function activateLocalSearch() {
  STATE.global = "";
  if ($("globalSearch")) $("globalSearch").value = "";
}

/* ---------- dialog forms ---------- */
function closeDialog() {
  const dialog = $("appDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.hasAttribute("open")) dialog.close();
  else dialog.removeAttribute("open");
}
function openForm(title, fields, onSubmit, submitLabel = "Save") {
  const dialog = $("appDialog"), form = $("dialogForm");
  if (!dialog || !form) return;
  setText("dialogTitle", title);
  setText("dialogError", "");
  $("dialogFields").innerHTML = fields.map((f) => {
    const value = f.value ?? "";
    let control;
    if (f.options) {
      control = `<select name="${esc(f.name)}" ${f.required ? "required" : ""}>${f.options.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
    } else {
      control = `<input name="${esc(f.name)}" type="${esc(f.type || "text")}" value="${esc(value)}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""} ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} ${f.step !== undefined ? `step="${f.step}"` : ""}>`;
    }
    return `<label><span>${esc(f.label)}</span>${control}${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`;
  }).join("");
  setText("dialogSubmit", submitLabel);
  $("dialogSubmit").hidden = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    $("dialogSubmit").disabled = true;
    setText("dialogError", "");
    try { await onSubmit(values); closeDialog(); }
    catch (error) { setText("dialogError", error.message); }
    finally { $("dialogSubmit").disabled = false; }
  };
  $("dialogClose").onclick = closeDialog;
  $("dialogCancel").onclick = closeDialog;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
function channelForm(channel) {
  const existing = channel || {};
  openForm(existing.id ? "Edit live channel" : "Add live channel", [
    { name: "name", label: "Channel name", value: existing.name, required: true, placeholder: "Example: Madani Channel HD" },
    { name: "url", label: "Licensed HLS / MP4 / DASH URL", value: existing.url, required: true, placeholder: "https://…/playlist.m3u8 or /media/…" },
    { name: "category", label: "Category", value: existing.category || "General", required: true },
    { name: "logo", label: "Logo URL (optional)", value: existing.logo, placeholder: "https://…/logo.png" },
    { name: "epgId", label: "XMLTV EPG ID", value: existing.epgId || "" },
    { name: "channelNumber", label: "Channel number (remote-control number)", type: "number", value: existing.channelNumber || STATE.channels.length + 1, min: 1, max: 999999, required: true, help: "Unique and stable. Reordering does not change this number or the stream ID." },
    { name: "position", label: "Channel number / playlist position", type: "number", value: existing.id ? STATE.channels.findIndex((c) => c.id === existing.id) + 1 : STATE.channels.length + 1, min: 1, max: existing.id ? Math.max(1, STATE.channels.length) : STATE.channels.length + 1, required: true, help: "Controls the order shown in the website, M3U, Xtream and MAG lists." },
    { name: "status", label: "Visibility", value: existing.status || "active", options: [["active", "Active / online"], ["offline", "Offline — show standby video"], ["inactive", "Hidden / inactive"]] },
    { name: "playbackMode", label: "Playback compatibility", value: existing.playbackMode || "auto", options: [["auto", "Auto — intro where compatible; preserve original source otherwise"], ["direct", "Direct — original adaptive stream, no external intro"]], help: "Use Direct for channels whose codecs/devices do not tolerate intro transitions. This does not change subscription checks before playback." },
    { name: "tier", label: "Access", value: existing.tier || "free", options: [["free", "Free preview"], ["pro", "PRO subscribers"]] }
  ], async (values) => {
    const position = Number(values.position);
    delete values.position;
    const result = await apiPost(existing.id ? "admin/channel-update" : "admin/channel-create", existing.id ? { id: existing.id, patch: values } : values);
    const channelId = existing.id || result.channel?.id;
    const currentPosition = existing.id ? STATE.channels.findIndex((c) => c.id === existing.id) + 1 : STATE.channels.length + 1;
    if (channelId && position !== currentPosition) await apiPost("admin/channel-move", { id: channelId, position });
    toast(existing.id ? "Channel updated" : "Channel added");
    await loadChannels();
  });
}
function playlistForm(playlist) {
  const existing = playlist || {};
  openForm(existing.id ? "Edit playlist" : "Add playlist", [
    { name: "name", label: "Playlist name", value: existing.name, required: true },
    { name: "url", label: "M3U/M3U8 URL", value: existing.url, required: true, placeholder: "https://…/playlist.m3u" }
  ], async (values) => {
    await apiPost("admin/playlist-save", { ...values, id: existing.id });
    toast("Playlist saved");
    await loadPlaylists();
  });
}
function xtreamCreateForm() {
  openForm("Create Xtream client", [
    { name: "name", label: "Client name", required: true, placeholder: "Client name" },
    { name: "username", label: "Username (optional)", help: "Lowercase letters, numbers and underscore. Blank = auto-generate." },
    { name: "password", label: "Password (optional)", help: "Blank = secure random password." },
    { name: "planId", label: "Plan", value: "monthly", options: [["trial-1d", "1-day trial"], ["monthly", "1 month"], ["quarterly", "3 months"], ["half-yearly", "6 months"], ["yearly", "12 months"]] },
    { name: "days", label: "Duration override (days)", type: "number", value: 30, min: 1, max: 3650, required: true },
    { name: "devices", label: "Connections", type: "number", value: 1, min: 1, max: 20, required: true },
    { name: "mac", label: "MAG MAC (optional)", placeholder: "00:1A:79:XX:XX:XX" },
    { name: "email", label: "Email (optional)", type: "email" },
    { name: "whatsapp", label: "WhatsApp (optional)" }
  ], async (values) => {
    const result = await apiPost("admin/xtream/create", values);
    toast(`⚡ ${result.client.username} created — password: ${result.client.password}`);
    await Promise.all([loadXtream(), loadUsers(), loadStalker(), loadAudit()]);
  }, "Create client");
}
function resellerCreateForm() {
  openForm("Create reseller", [
    { name: "name", label: "Dealer name", required: true },
    { name: "code", label: "Dealer code (optional)", placeholder: "AUTO" },
    { name: "username", label: "Login username (optional)", help: "3–24 lowercase letters, numbers or underscore. Defaults to dealer code." },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "password", label: "Panel password", type: "password", required: true, help: "Minimum 8 characters; dealer can change it later in Account security." },
    { name: "whatsapp", label: "WhatsApp" },
    { name: "credits", label: "Starter credits", type: "number", value: 10, min: 0, max: 10000 }
  ], async (values) => {
    const result = await apiPost("admin/reseller-create", values);
    const reseller = result.reseller;
    if ($("resellerNewCard")) $("resellerNewCard").hidden = false;
    setText("resellerNewValue", `Panel: ${location.origin}/reseller\nCode: ${reseller.code}\nUsername: ${reseller.username || reseller.code.toLowerCase()}\nAPI key: ${reseller.apiKey}`);
    toast("🏪 Reseller created — copy credentials now");
    await loadResellers();
  }, "Create reseller");
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    const area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    const copied = document.execCommand?.("copy");
    area.remove();
    return !!copied;
  } catch { return false; }
}

/* ---------- M3U + XMLTV imports ---------- */
function importStatus(id, message, tone = "") {
  const el = $(id);
  if (el) { el.textContent = String(message || ""); el.className = "import-status" + (tone ? " " + tone : ""); }
}
async function fileText(file, maxBytes) {
  if (!file) throw new Error("Please choose a file first.");
  if (file.size > maxBytes) throw new Error(`File is too large (maximum ${Math.round(maxBytes / 1_000_000)} MB).`);
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.readAsText(file);
  });
}
async function importM3u(source) {
  const buttons = [$("m3uUrlBtn"), $("m3uFileBtn")].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  importStatus("m3uImportStatus", source === "url" ? "Downloading and validating playlist…" : "Reading and validating playlist…");
  try {
    const payload = { name: $("m3uName")?.value.trim(), defaultTier: $("m3uTier")?.value || "free", importEpg: !!$("m3uImportEpg")?.checked };
    if (source === "url") {
      payload.url = $("m3uUrl")?.value.trim();
      if (!payload.url) throw new Error("Enter an M3U URL first.");
    } else {
      const file = $("m3uFile")?.files?.[0];
      payload.filename = file?.name || "upload.m3u";
      payload.content = await fileText(file, 5_000_000);
    }
    const result = await apiPost("admin/channels/import", payload);
    const epgNote = result.epgErrors?.length ? `\nEPG warning: ${result.epgErrors[0].error}` : result.epgImports?.length ? `\nEPG: ${result.epgImports.reduce((sum, item) => sum + Number(item.programmes || 0), 0)} programmes imported.` : "";
    importStatus("m3uImportStatus", `✅ ${result.created} created • ${result.updated} updated • ${result.skipped} skipped.${epgNote}`, result.epgErrors?.length ? "err" : "ok");
    toast(`📥 ${result.imported} channels imported`);
    if ($("m3uUrl")) $("m3uUrl").value = "";
    if ($("m3uFile")) $("m3uFile").value = "";
    await Promise.all([loadChannels(), loadPlaylists(), loadEpgSources(), loadEpgMapping(), loadAudit()]);
  } catch (error) { importStatus("m3uImportStatus", error.message, "err"); toast(error.message, "error"); }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}
async function importEpg(source) {
  const buttons = [$("epgUrlBtn"), $("epgFileBtn")].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  importStatus("epgImportStatus", "Parsing XMLTV channels and programmes…");
  try {
    const payload = { name: $("epgName")?.value.trim() };
    if (source === "url") {
      payload.url = $("epgUrl")?.value.trim();
      if (!payload.url) throw new Error("Enter an XMLTV URL first.");
    } else {
      const file = $("epgFile")?.files?.[0];
      payload.filename = file?.name || "guide.xml";
      payload.content = await fileText(file, 8_000_000);
    }
    const result = await apiPost("admin/epg-import", payload);
    importStatus("epgImportStatus", `✅ ${result.channels} channels • ${result.programmes} programmes imported (${result.skipped} skipped).`, "ok");
    toast("🗓️ EPG guide updated");
    if ($("epgUrl")) $("epgUrl").value = "";
    if ($("epgFile")) $("epgFile").value = "";
    await Promise.all([loadEpgSources(), loadEpgMapping(), loadAudit()]);
  } catch (error) { importStatus("epgImportStatus", error.message, "err"); toast(error.message, "error"); }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}

/* ---------- controls ---------- */
function appInit() {
  if (window.__mzAdminInit) return;
  window.__mzAdminInit = true;
  document.querySelectorAll(".nav-btn").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

  const catalogSearch = debounce(() => { Promise.allSettled([loadMovies(), loadSeries()]); });
  $("globalSearch")?.addEventListener("input", (event) => {
    STATE.global = event.target.value;
    renderLocalSearches();
    catalogSearch();
  });
  const searchMap = { chSearch: "channels", xtSearch: "xtream", usSearch: "users", rsSearch: "resellers" };
  for (const [id, key] of Object.entries(searchMap)) {
    $(id)?.addEventListener("input", (event) => { activateLocalSearch(); STATE.filters[key] = event.target.value; renderLocalSearches(); });
  }
  for (const [id, key] of [["mvSearch", "movies"], ["srSearch", "series"]]) {
    $(id)?.addEventListener("input", (event) => { activateLocalSearch(); STATE.filters[key] = event.target.value; catalogSearch(); });
  }
  for (const id of ["chCategoryFilter", "chAccessFilter", "chSort"]) $(id)?.addEventListener("change", renderChannels);
  $("chApplySort")?.addEventListener("click", async () => {
    const mode = $("chSort")?.value || "order";
    if (mode === "order") return toast("Choose a sort mode first.", "error");
    try { await apiPost("admin/channel-sort", { mode }); await loadChannels(); toast("Sort published to website, M3U, Xtream and MAG"); } catch (e) { toast(e.message, "error"); }
  });
  for (const [prefix, kind, loader] of [["mv", "movies", loadMovies], ["sr", "series", loadSeries]]) {
    for (const suffix of ["Sort", "Category", "Ready"]) $(prefix + suffix)?.addEventListener("change", () => { STATE.catalog[kind].offset = 0; loader().catch((e) => toast(e.message, "error")); });
    for (const [suffix, delta] of [["Prev", -80], ["Next", 80]]) $(prefix + suffix)?.addEventListener("click", () => { STATE.catalog[kind].offset = Math.max(0, STATE.catalog[kind].offset + delta); loader().catch((e) => toast(e.message, "error")); });
    $(prefix + "PersistSort")?.addEventListener("click", async () => {
      if (!confirm("Save this sort order for the entire catalog and IPTV outputs?")) return;
      try { const result = await apiPost("admin/catalog-sort", { kind, mode: $(prefix + "Sort").value }); STATE.catalog[kind].offset = 0; await loader(); toast(`${result.count} titles ordered`); } catch (e) { toast(e.message, "error"); }
    });
  }
  $("epgAutoMap")?.addEventListener("click", async () => { try { const result = await apiPost("admin/epg-auto-map"); await Promise.all([loadEpgMapping(), loadChannels()]); toast(`${result.mapped} unique channel mappings added`); } catch (e) { toast(e.message, "error"); } });
  $("epgMapRefresh")?.addEventListener("click", () => loadEpgMapping().catch((e) => toast(e.message, "error")));
  $("stUseBundled")?.addEventListener("click", () => {
    const values = { stWelcome: "/media/welcome/video.mp4", stOffline: "/media/channel-offline/index.m3u8", stComing: "/media/coming-soon/index.m3u8", stPro: "/media/pro-unlock/index.m3u8", stWelcomeDuration: "8" };
    for (const [id, value] of Object.entries(values)) if ($(id)) $(id).value = value;
    $("stServerlessHls").checked = true; $("stWelcomeEnabled").checked = true; $("stWelcomeSkippable").checked = false; $("stProEnabled").checked = true;
    $("introPreview").src = values.stWelcome; toast("New video package selected — save settings to publish.");
  });

  $("lockGoogleBtn")?.addEventListener("click", async () => {
    lockErr("");
    const button = $("lockGoogleBtn");
    if (button) button.disabled = true;
    const result = await loginWithGoogle();
    if (button) button.disabled = false;
    if (!result.ok) {
      const hint = result.code === "auth/unauthorized-domain" ? ` — Firebase → Auth → Authorized domains mein ${location.hostname} add karein, ya Owner PIN use karein.` : "";
      lockErr((result.error || "Google sign-in failed") + hint);
    }
  });
  $("lockGoogleRedirectBtn")?.addEventListener("click", async () => {
    lockErr("Redirecting…");
    const result = await loginWithGoogleRedirect();
    if (!result.ok) lockErr(result.error || "Redirect sign-in failed");
  });
  $("lockPinBtn")?.addEventListener("click", () => pinLogin($("lockPinIn")?.value.trim()));
  $("lockPinIn")?.addEventListener("keydown", (event) => { if (event.key === "Enter") $("lockPinBtn")?.click(); });
  $("btnLogout")?.addEventListener("click", async () => {
    await logoutUser();
    try { localStorage.removeItem("mz_admin_session"); localStorage.removeItem("mz_admin_key"); } catch {}
    location.reload();
  });
  $("btnTheme")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("mz_theme", next); } catch {}
    setText("btnTheme", next === "dark" ? "◐" : "◑");
  });
  safe("theme", () => {
    const theme = localStorage.getItem("mz_theme");
    if (theme) { document.documentElement.dataset.theme = theme; setText("btnTheme", theme === "dark" ? "◐" : "◑"); }
  });
  $("btnRefresh")?.addEventListener("click", async () => { await loadAll(); toast("Panel data refreshed"); });

  $("chAddBtn")?.addEventListener("click", () => channelForm());
  $("qAddChannel")?.addEventListener("click", () => channelForm());
  $("plAddBtn")?.addEventListener("click", () => playlistForm());
  $("m3uUrlBtn")?.addEventListener("click", () => importM3u("url"));
  $("m3uFileBtn")?.addEventListener("click", () => importM3u("file"));
  $("epgUrlBtn")?.addEventListener("click", () => importEpg("url"));
  $("epgFileBtn")?.addEventListener("click", () => importEpg("file"));
  $("epgRefreshList")?.addEventListener("click", () => loadEpgSources().catch((error) => toast(error.message, "error")));
  $("rsAddBtn")?.addEventListener("click", resellerCreateForm);
  $("resellerCopyBtn")?.addEventListener("click", async () => toast(await copyText($("resellerNewValue")?.textContent || "") ? "Reseller credentials copied" : "Clipboard unavailable"));
  $("xtAddBtn")?.addEventListener("click", xtreamCreateForm);
  $("qGo")?.addEventListener("click", () => {
    const value = $("qSearch")?.value || "";
    activateLocalSearch();
    STATE.filters.channels = value;
    if ($("chSearch")) $("chSearch").value = value;
    switchTab("channels");
    renderChannels();
  });
  $("qSearch")?.addEventListener("keydown", (event) => { if (event.key === "Enter") $("qGo")?.click(); });
  $("stRefreshBtn")?.addEventListener("click", () => loadStalker().then(() => toast("MAG list refreshed")).catch((e) => toast(e.message, "error")));
  $("errRefresh")?.addEventListener("click", () => loadAnalytics().catch((e) => toast(e.message, "error")));
  $("stSave")?.addEventListener("click", async () => {
    const button = $("stSave");
    if (button) button.disabled = true;
    try {
      await apiPost("admin/settings-set", { patch: {
        welcomeVideoUrl: $("stWelcome")?.value.trim(), channelOfflineVideoUrl: $("stOffline")?.value.trim(),
        comingSoonVideoUrl: $("stComing")?.value.trim(), proUnlockVideoUrl: $("stPro")?.value.trim(),
        serverlessHlsEnabled: !!$("stServerlessHls")?.checked,
        welcomeVideoEnabled: !!$("stWelcomeEnabled")?.checked, welcomeSkippable: !!$("stWelcomeSkippable")?.checked,
        welcomeDurationSec: Number($("stWelcomeDuration")?.value || 8),
        proUnlockVideoEnabled: !!$("stProEnabled")?.checked,
        paymentMethod: $("stPaymentMethod")?.value.trim(), paymentAccountNumber: $("stPaymentAccount")?.value.trim(),
        paymentAccountTitle: $("stPaymentTitle")?.value.trim(), businessIntroText: $("stBusinessIntro")?.value.trim(),
        proWhatsapp: $("stWa")?.value.trim(), proWhatsappIntl: $("stWaIntl")?.value.trim(),
        siteAnnouncement: $("stTicker")?.value.trim(), rechargeNote: $("stRechargeNote")?.value.trim(),
        resellerContactNote: $("stResellerNote")?.value.trim()
      } });
      toast("💾 Settings saved");
      await Promise.all([loadSettings(), loadAudit()]);
    } catch (error) { toast(error.message, "error"); }
    finally { if (button) button.disabled = false; }
  });
  $("keyCreateBtn")?.addEventListener("click", async () => {
    const button = $("keyCreateBtn");
    if (button) button.disabled = true;
    try {
      const result = await apiPost("admin/api-key-create", { label: "panel-" + new Date().toISOString().slice(0, 10), expiresDays: 0 });
      if ($("keyNewCard")) { $("keyNewCard").hidden = false; $("keyNewCard").classList.remove("hidden"); }
      setText("keyNewValue", result.apiKey);
      toast("🔑 API key created — copy it now");
      await loadApiKeys();
    } catch (error) { toast(error.message, "error"); }
    finally { if (button) button.disabled = false; }
  });
  $("keyCopyBtn")?.addEventListener("click", async () => toast(await copyText($("keyNewValue")?.textContent || "") ? "API key copied" : "Clipboard unavailable — key manually select karein", "ok"));

  document.addEventListener("click", async (event) => {
    const el = event.target.closest("[data-ch-check],[data-epg-save],[data-rs-edit],[data-xt-edit],[data-rs-topup],[data-rs-report],[data-rs-toggle],[data-or-approve],[data-or-reject],[data-key-revoke],[data-xt-renew],[data-xt-toggle],[data-xt-del],[data-ch-move],[data-ch-edit],[data-ch-del],[data-pl-edit],[data-pl-del],[data-epg-refresh],[data-epg-delete],[data-mv-stream],[data-sr-episodes],[data-user-copy]");
    if (!el) return;
    try {
      if (el.dataset.chMove) {
        const index = STATE.channels.findIndex((channel) => String(channel.id) === el.dataset.chMove);
        const position = index + 1 + Number(el.dataset.direction);
        if (index < 0 || position < 1 || position > STATE.channels.length) return;
        el.disabled = true;
        await apiPost("admin/channel-move", { id: el.dataset.chMove, position });
        toast("Channel order updated"); await loadChannels(); return;
      }
      if (el.dataset.chCheck) {
        el.disabled = true;
        try { const result = await apiPost("admin/channel-check", { id: el.dataset.chCheck }); toast(result.message, result.online ? "ok" : "error"); await loadChannels(); } finally { el.disabled = false; }
        return;
      }
      if (el.dataset.epgSave) {
        const select = document.querySelector(`[data-epg-channel="${el.dataset.epgSave}"]`);
        await apiPost("admin/epg-map", { id: el.dataset.epgSave, epgId: select?.value || "" });
        toast("EPG mapping saved"); await Promise.all([loadEpgMapping(), loadChannels()]); return;
      }
      if (el.dataset.rsEdit) {
        const record = STATE.resellers.find((r) => r.code === el.dataset.rsEdit);
        return openForm(`Reseller login · ${record.code}`, [
          { name: "username", label: "Login username", value: record.username || record.code.toLowerCase(), required: true },
          { name: "newPassword", label: "New password (optional)", type: "password", help: "Leave blank to keep password. Setting a password rotates the API key and signs out other sessions." },
          { name: "name", label: "Business name", value: record.name || "" },
          { name: "whatsapp", label: "WhatsApp", value: record.whatsapp || "" }
        ], async (values) => {
          const result = await apiPost("admin/reseller-update", { code: record.code, patch: values });
          if (result.apiKey) { $("resellerNewCard").hidden = false; setText("resellerNewValue", `Code: ${record.code}\nUsername: ${result.reseller.username}\nNew API key: ${result.apiKey}`); }
          toast("Reseller login updated"); await loadResellers();
        });
      }
      if (el.dataset.xtEdit) {
        const account = STATE.xtream.find((a) => a.username === el.dataset.xtEdit);
        const client = STATE.clients.find((c) => c.username === account.username) || {};
        return openForm(`Edit client · ${account.username}`, [
          { name: "newUsername", label: "Username", value: account.username, required: true },
          { name: "password", label: "New password (optional)", type: "password", help: "Leave blank to keep current password. Old playlist URLs stop working after a credential change." },
          { name: "name", label: "Client name", value: client.name || account.displayName || "" },
          { name: "whatsapp", label: "WhatsApp", value: client.whatsapp || "" },
          { name: "mac", label: "MAG MAC", value: account.mac || "" },
          { name: "devices", label: "Connections", type: "number", value: account.maxConnections || 1, min: 1, max: 20 }
        ], async (values) => {
          if (!values.password) delete values.password;
          await apiPost("admin/xtream/update", { username: account.username, ...values });
          toast("Client credentials updated — share the new playlist links"); await Promise.all([loadXtream(), loadUsers(), loadStalker()]);
        });
      }
      if (el.dataset.chEdit) return channelForm(STATE.channels.find((c) => c.id === el.dataset.chEdit));
      if (el.dataset.plEdit) return playlistForm(STATE.playlists.find((p) => p.id === el.dataset.plEdit));
      if (el.dataset.epgRefresh) {
        el.disabled = true;
        await apiPost("admin/epg-refresh", { id: el.dataset.epgRefresh });
        toast("🗓️ Remote EPG refreshed"); await loadEpgSources(); return;
      }
      if (el.dataset.epgDelete) {
        if (!confirm("Delete this EPG source and all of its programmes?")) return;
        await apiPost("admin/epg-delete", { id: el.dataset.epgDelete });
        toast("EPG source deleted"); await loadEpgSources(); return;
      }
      if (el.dataset.mvStream) {
        const movie = STATE.movies.find((m) => m.id === el.dataset.mvStream);
        return openForm(`Stream URL — ${movie?.title || "Movie"}`, [{ name: "streamUrl", label: "Licensed MP4/HLS URL", placeholder: "https://…/movie.mp4", help: "Only add content you have rights to stream. Blank removes playback." }], async (values) => {
          await apiPost("admin/movie-update", { id: el.dataset.mvStream, patch: values });
          toast("Movie playback updated"); await loadMovies();
        });
      }
      if (el.dataset.srEpisodes) {
        const series = STATE.series.find((item) => item.id === el.dataset.srEpisodes);
        const episodes = series?.episodes || [];
        if (!episodes.length) return toast("No episodes in this catalog entry", "error");
        return openForm(`Episode stream — ${series.title || "Series"}`, [
          { name: "episodeId", label: "Episode", type: "select", options: episodes.map((ep) => [ep.id, `S${String(ep.season || 1).padStart(2, "0")}E${String(ep.episode || 1).padStart(2, "0")} — ${ep.title || ep.id}${ep.streamAvailable ? " (ready)" : ""}`]) },
          { name: "streamUrl", label: "Licensed episode URL", placeholder: "https://…/episode.mp4", help: "MP4 or HLS URL. Blank removes playback for the selected episode." }
        ], async (values) => {
          await apiPost("admin/series-update", { id: series.id, patch: { episodes: [{ id: values.episodeId, streamUrl: values.streamUrl }] } });
          toast("Episode playback updated"); await loadSeries();
        });
      }
      if (el.dataset.rsReport) {
        const result = await apiGet("admin/reseller-report", { code: el.dataset.rsReport });
        const report = result.report;
        const box = $("rsReport");
        if (box) {
          box.hidden = false;
          box.innerHTML = `<h3>📊 ${esc(report.reseller.code)} · Business report</h3><p>Clients: ${Number(report.stats.total)} · Active: ${Number(report.stats.active)} · Expiring in 7 days: ${Number(report.stats.expiringSoon)} · Collected: Rs ${Number(report.finance.collectedTotal)} · Credits used: ${Number(report.finance.creditsUsed)}</p><p>Recent business events (not viewer tracking)</p><ul>${(report.activity || []).slice(0, 15).map((entry) => `<li>${esc(entry.at)} · ${esc(entry.action)} · ${esc(entry.detail?.username || "")}</li>`).join("") || "<li>No activity yet</li>"}</ul>`;
        }
        return;
      }
      if (el.dataset.rsToggle) {
        const status = el.dataset.rsSuspended === "true" ? "active" : "suspended";
        if (!confirm(`${status === "active" ? "Activate" : "Suspend"} reseller ${el.dataset.rsToggle}?`)) return;
        await apiPost("admin/reseller-update", { code: el.dataset.rsToggle, patch: { status } });
        toast(`Reseller ${status}`); await loadResellers(); return;
      }
      if (el.dataset.rsTopup) {
        const code = el.dataset.rsTopup;
        return openForm(`Top up ${code}`, [{ name: "credits", label: "Credits to add", type: "number", value: 10, min: 1, max: 10000, required: true }], async (values) => {
          await apiPost("admin/credits-topup", { code, credits: Number(values.credits) });
          toast(`+${values.credits} credits`); await loadResellers();
        }, "Add credits");
      }
      if (el.dataset.userCopy) {
        const client = STATE.clients.find((c) => c.username === el.dataset.userCopy);
        if (!client) return;
        const text = `Mizanora IPTV\nServer: ${location.origin}\nUsername: ${client.username}\nPassword: ${client.password}\nM3U: ${location.origin}/get.php?username=${encodeURIComponent(client.username)}&password=${encodeURIComponent(client.password)}&type=m3u_plus&output=m3u8`;
        return toast(await copyText(text) ? "Client credentials copied" : "Clipboard unavailable", "ok");
      }
      if (el.dataset.chDel) {
        if (!confirm("Delete this channel?")) return;
        await apiPost("admin/channel-delete", { id: el.dataset.chDel }); toast("Channel deleted"); await loadChannels(); return;
      }
      if (el.dataset.plDel) {
        if (!confirm("Delete this playlist?")) return;
        await apiPost("admin/playlist-delete", { id: el.dataset.plDel }); toast("Playlist deleted"); await loadPlaylists(); return;
      }
      if (el.dataset.orApprove) {
        const result = await apiPost("admin/order-review", { id: el.dataset.orApprove, approve: true });
        toast("✅ Approved — client: " + (result.client?.username || "")); await Promise.all([loadOrders(), loadXtream(), loadUsers()]); return;
      }
      if (el.dataset.orReject) {
        if (!confirm("Reject this order?")) return;
        await apiPost("admin/order-review", { id: el.dataset.orReject, approve: false }); toast("Order rejected"); await loadOrders(); return;
      }
      if (el.dataset.keyRevoke) {
        if (!confirm("Revoke this API key immediately?")) return;
        await apiPost("admin/api-key-revoke", { id: el.dataset.keyRevoke }); toast("Key revoked"); await loadApiKeys(); return;
      }
      if (el.dataset.xtRenew) {
        await apiPost("admin/xtream/renew", { username: el.dataset.xtRenew, planId: "monthly" }); toast("🔄 Renewed for 30 days"); await Promise.all([loadXtream(), loadUsers()]); return;
      }
      if (el.dataset.xtToggle) {
        const active = el.dataset.xtActive === "true";
        await apiPost(active ? "admin/xtream/suspend" : "admin/xtream/activate", { username: el.dataset.xtToggle });
        toast(active ? "⏸ Suspended" : "▶️ Activated"); await Promise.all([loadXtream(), loadUsers(), loadStalker()]); return;
      }
      if (el.dataset.xtDel) {
        if (!confirm(`Permanently delete ${el.dataset.xtDel}?`)) return;
        await apiPost("admin/xtream/delete", { username: el.dataset.xtDel }); toast("🗑 Client deleted"); await Promise.all([loadXtream(), loadUsers(), loadStalker()]);
      }
    } catch (error) { toast(error.message, "error"); }
  });
}

/* ---------- boot ---------- */
(async () => {
  safe("appInit", appInit);
  safe("subscribeAuth", () => subscribeAuth((user) => { safe("onAuthUser", () => onAuthUser(user)); }));
  safe("finishRedirect", async () => {
    const result = await finishRedirect();
    if (result?.ok) await onAuthUser(result.user);
  });
  if (adminToken()) await enterAdmin({ displayName: "Owner (PIN)", email: ADMIN_EMAIL, uid: "owner_pin" });
  else showLock();
})().catch((error) => {
  console.error("boot failed", error);
  showLock("Boot error: " + (error?.message || error));
});


// Broadcast Studio: the preview exercises the same Vercel manifest path as IPTV.
let studioHls = null, studioUrl = "", studioRequest = 0;
function stopStudio() {
  studioRequest++; studioUrl = "";
  studioHls?.destroy(); studioHls = null;
  const video = $("studioVideo");
  if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  setText("studioMode", "Preview stopped");
}
async function inspectStudio() {
  if (!studioUrl) return;
  const request = studioRequest;
  const response = await fetch(studioUrl, { cache: "no-store" });
  const text = await response.text();
  if (request !== studioRequest) return;
  if (!response.ok) throw new Error("Preview manifest unavailable");
  studioUrl = response.url || studioUrl;
  setText("studioManifest", text);
  setText("studioMode", (response.headers.get("x-mizanora-playout") || "Direct-source preview") + (response.headers.get("x-mizanora-recovery") === "retrying-source" ? " · retrying source" : ""));
}
async function startStudio(card = "") {
  stopStudio();
  const request = studioRequest;
  if (card === "intro") card = "";
  const id = $("studioChannel")?.value || STATE.channels.find(c => c.status !== "inactive")?.id;
  if (!card && !id) return toast("Add or choose a channel first", "error");
  setText("studioStatus", "Preparing signed HLS preview…");
  try {
    const result = await apiPost("admin/playout-preview", card ? { card } : { id });
    if (request !== studioRequest) return;
    studioUrl = result.url;
    await inspectStudio();
    if (request !== studioRequest) return;
    const video = $("studioVideo");
    video.muted = true;
    if (window.Hls?.isSupported()) {
      studioHls = new window.Hls({ startPosition: 0, manifestLoadingTimeOut: 30000, levelLoadingTimeOut: 30000 });
      studioHls.loadSource(studioUrl); studioHls.attachMedia(video);
      studioHls.on(window.Hls.Events.MANIFEST_PARSED, () => { if (request === studioRequest) video.play().catch(() => setText("studioStatus", "Press Play to begin the preview.")); });
      studioHls.on(window.Hls.Events.ERROR, (_, data) => { if (request === studioRequest && data.fatal) setText("studioStatus", "Player error: " + data.details + ". Inspect the manifest and source codec/CORS settings."); });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = studioUrl; video.play().catch(() => {}); }
    else setText("studioStatus", "HLS preview needs a compatible browser. The manifest below can still be inspected.");
    if (window.Hls?.isSupported() || video.canPlayType("application/vnd.apple.mpegurl")) setText("studioStatus", "Preview playing muted. Use the player controls for sound; refresh the inspector to see the current live sequence.");
  } catch (error) { if (request === studioRequest) { setText("studioStatus", error.message); toast(error.message, "error"); } }
}
document.addEventListener("click", event => {
  const nav = event.target.closest("[data-open-tab]");
  if (nav) switchTab(nav.dataset.openTab);
  const card = event.target.closest("[data-studio-card]");
  if (card) startStudio(card.dataset.studioCard);
});
$("studioStart")?.addEventListener("click", () => startStudio());
$("studioStop")?.addEventListener("click", stopStudio);
$("studioInspect")?.addEventListener("click", () => inspectStudio().catch(error => toast(error.message, "error")));
$("btnLogout")?.addEventListener("click", stopStudio);
window.addEventListener("pagehide", stopStudio);
