/**
 * Mizanora IPTV — Admin Panel logic (FRESH REBUILD)
 * Hardened by design: safe() step wrapper, setText null-safe writes, explicit
 * TAB_VIEWS map, idempotent init, controls bound BEFORE auth so the panel can
 * never end up dead.
 */
import {
  subscribeAuth, loginWithGoogle, loginWithGoogleRedirect, finishRedirect,
  logoutUser, getFirebaseIdToken, isAdminEmail, ADMIN_EMAIL, dbRead, dbWatch
} from "/assets/js/firebase-client.js?v=4";

/* ---------- tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const safe = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === "function") r.catch((e) => console.error(`[${name}]`, e));
    return r;
  } catch (e) { console.error(`[${name}]`, e); }
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const show = (el) => el && (el.hidden = false);
const hide = (el) => el && (el.hidden = true);
function toast(msg, tone = "ok") {
  const box = $("toasts");
  if (!box) return;
  const t = document.createElement("div");
  t.className = "toast" + (tone === "error" ? " err" : "");
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

const STATE = {
  user: null, tab: "dashboard", search: "",
  channels: [], playlists: [], xtream: [], movies: [], series: [],
  clients: [], resellers: [], orders: [], stalker: [], keys: [], audit: []
};

const TAB_VIEWS = {
  dashboard: "viewDashboard", channels: "viewChannels", playlists: "viewPlaylists",
  xtream: "viewXtream", movies: "viewMovies", series: "viewSeries",
  analytics: "viewAnalytics", users: "viewUsers", settings: "viewSettings",
  resellers: "viewResellers", orders: "viewOrders", stalker: "viewStalker",
  apikeys: "viewApiKeys"
};
const TAB_TITLES = {
  dashboard: ["📊 Dashboard", "Real-time IPTV server overview"],
  channels: ["📺 Channel Manager", "All live channels"],
  playlists: ["📋 Playlists", "Cloud M3U playlists"],
  xtream: ["⚡ Xtream Accounts", "All Xtream users — renew / suspend / delete"],
  movies: ["🎬 Movies", "IMDb movie catalog"],
  series: ["📺 Series", "IMDb series catalog"],
  analytics: ["📈 Live Analytics", "Visitors, sessions, plays, client errors"],
  users: ["👤 Users", "Panel clients"],
  settings: ["⚙️ Settings", "Brand, videos, WhatsApp, ticker"],
  resellers: ["🏪 Resellers", "Dealers, credits, top-up"],
  orders: ["🧾 Orders", "Approve to auto-provision Xtream"],
  stalker: ["🛰️ Stalker / MAG", "MAC-bound clients + portal URL"],
  apikeys: ["🔑 API Keys", "mzk_ admin keys — create / revoke"]
};

/* ---------- API helpers ---------- */
function adminToken() {
  try {
    const raw = localStorage.getItem("mz_admin_session");
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.token || Date.now() > Number(s.expiresAt || 0)) { localStorage.removeItem("mz_admin_session"); return null; }
    return s.token;
  } catch { return null; }
}
async function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = adminToken();
  if (t) h["x-admin-token"] = t;
  const idt = await safe("idToken", () => getFirebaseIdToken());
  if (idt) h.Authorization = "Bearer " + idt;
  const key = localStorage.getItem("mz_admin_key");
  if (key) h["x-api-key"] = key;
  return h;
}
async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch("/api/panel?" + qs, { headers: await authHeaders() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `API ${action} failed (${res.status})`);
  return d;
}
async function apiPost(action, payload = {}) {
  const res = await fetch("/api/panel", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `API ${action} failed (${res.status})`);
  return d;
}

/* ---------- lock / unlock ---------- */
function lockErr(m) { const e = $("lockErr"); if (e) { e.textContent = m || ""; } }
function showLock(msg) {
  const l = $("adminLock"); if (l) l.classList.add("show");
  document.body.classList.add("is-locked");
  document.body.classList.remove("unlocked");
  lockErr(msg || "");
}
function hideLock() {
  const l = $("adminLock"); if (l) l.classList.remove("show");
  document.body.classList.remove("is-locked");
  document.body.classList.add("unlocked");
}
function paintUser() {
  const u = STATE.user;
  if (!u) return;
  const pinWrap = $("admPinStatic"); if (pinWrap) pinWrap.hidden = true;
  setText("userName", u.displayName || u.email || "Admin");
  setText("userRole", isAdminEmail(u.email) ? "👑 Super Admin (Owner)" : "Admin");
  setText("userAvatar", (u.displayName || u.email || "A").slice(0, 2).toUpperCase());
}
async function enterAdmin(user) {
  STATE.user = user;
  safe("paintUser", paintUser);
  safe("hideLock", hideLock);
  safe("appInit", () => appInit());
  await loadAll();
  safe("switchTab", () => switchTab(STATE.tab || "dashboard"));
}

/* ---------- auth flow ---------- */
async function onAuthUser(u) {
  if (u) {
    if (!isAdminEmail(u.email)) {
      showLock(`⛔ Access denied — ye panel sirf ${ADMIN_EMAIL} ke liye hai.`);
      safe("logout", logoutUser);
      localStorage.removeItem("mz_admin_session");
      return;
    }
    await enterAdmin({ displayName: u.displayName || u.email, email: u.email, uid: u.uid });
  } else if (!adminToken()) {
    showLock();
    setText("userName", "🔒 Locked");
    setText("userRole", "Google owner login ya Owner PIN required");
    setText("userAvatar", "🔒");
  }
}
async function pinLogin(pin) {
  if (!pin) return toast("Enter the Owner PIN.", "error");
  try {
    const res = await apiPost("admin/pin-login", { pin });
    localStorage.setItem("mz_admin_session", JSON.stringify({ token: res.token, expiresAt: Date.now() + (res.expiresIn || 43200) * 1000 }));
    await enterAdmin({ displayName: "Owner (PIN)", email: ADMIN_EMAIL, uid: "owner_pin" });
    toast("👑 Owner access granted");
  } catch (err) {
    lockErr(err.message);
    toast(err.message, "error");
  }
}

/* ---------- tabs ---------- */
function switchTab(tab) {
  STATE.tab = tab;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("section[id^=view]").forEach((s) => hide(s));
  const el = $(TAB_VIEWS[tab] || ("view" + tab.charAt(0).toUpperCase() + tab.slice(1)));
  if (el) show(el); else console.warn("switchTab: no view for", tab);
  const [t, s] = TAB_TITLES[tab] || [tab, ""];
  setText("pageTitle", t);
  setText("pageSub", s);
}

/* ---------- loaders ---------- */
async function loadAll() {
  await Promise.allSettled([
    safe("loadChannels", loadChannels), safe("loadPlaylists", loadPlaylists),
    safe("loadXtream", loadXtream), safe("loadMovies", loadMovies),
    safe("loadSeries", loadSeries), safe("loadUsers", loadUsers),
    safe("loadSettings", loadSettings), safe("loadAnalytics", loadAnalytics),
    safe("loadResellers", loadResellers), safe("loadOrders", loadOrders),
    safe("loadStalker", loadStalker), safe("loadApiKeys", loadApiKeys), safe("loadAudit", loadAudit)
  ]);
}
async function loadChannels() {
  const d = await apiGet("admin/channels");
  STATE.channels = (d.channels || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  setText("badgeChannels", STATE.channels.length);
  setText("kpiChannels", STATE.channels.length);
  const pro = STATE.channels.filter((c) => String(c.tier || "pro").toLowerCase() === "pro").length;
  setText("kpiChannelsSub", `${STATE.channels.length - pro} Free • ${pro} PRO`);
  renderChannels();
}
function renderChannels() {
  const tb = $("chBody"); if (!tb) return;
  const q = STATE.search.toLowerCase();
  const rows = STATE.channels
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !q || (c.name || "").toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q));
  tb.innerHTML = rows.map(({ c, i }) => {
    const tier = String(c.tier || "pro").toLowerCase() === "free" ? '<span class="badge free">FREE</span>' : '<span class="badge pro">👑 PRO</span>';
    const prev = c.previewVideoUrl
      ? `<span class="ch-preview">🎬<video muted loop playsinline preload="metadata" src="${esc(c.previewVideoUrl)}"></video></span>`
      : '<span style="color:var(--dim)">—</span>';
    return `<tr data-row data-id="${esc(c.id)}" draggable="true">
      <td class="drag-handle" title="Drag to reorder">⠿</td>
      <td>${i + 1}</td>
      <td>${c.logo ? `<img src="${esc(c.logo)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : "📺"}</td>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.category || "")}</td>
      <td>${tier}</td>
      <td>${prev}</td>
      <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.url)}">${esc(c.url || "")}</td>
      <td><button class="btn btn-ghost btn-sm" data-ch-edit="${esc(c.id)}">✎</button>
      <button class="btn btn-danger btn-sm" data-ch-del="${esc(c.id)}">🗑</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="9" style="color:var(--dim)">No channels yet — ＋ Add ya M3U import karo.</td></tr>';
  bindDragSort(tb);
}

/* ---- drag & drop sort ---- */
let dragId = null;
function bindDragSort(tb) {
  tb.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("dragstart", (e) => { dragId = tr.dataset.id; tr.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    tr.addEventListener("dragend", () => { tr.classList.remove("dragging"); tb.querySelectorAll(".drag-over").forEach((x) => x.classList.remove("drag-over")); dragId = null; });
    tr.addEventListener("dragover", (e) => { e.preventDefault(); tr.classList.add("drag-over"); });
    tr.addEventListener("dragleave", () => tr.classList.remove("drag-over"));
    tr.addEventListener("drop", (e) => {
      e.preventDefault();
      tr.classList.remove("drag-over");
      if (!dragId || dragId === tr.dataset.id) return;
      const ids = [...tb.querySelectorAll("tr[data-id]")].map((r) => r.dataset.id);
      const from = ids.indexOf(dragId), to = ids.indexOf(tr.dataset.id);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      const byId = new Map(STATE.channels.map((c) => [c.id, c]));
      STATE.channels = ids.map((id) => byId.get(id)).filter(Boolean);
      renderChannels();
      toast("Order badla — 💾 Save order dabao");
    });
  });
}

/* ---- channel edit modal ---- */
function openChannelModal(ch) {
  const m = $("chModal"); if (!m) return;
  setText("chModalTitle", ch ? "✎ Edit channel" : "＋ Add channel");
  $("chId").value = ch?.id || "";
  $("chName").value = ch?.name || "";
  $("chUrl").value = ch?.url || "";
  $("chLogo").value = ch?.logo || "";
  $("chGroup").value = ch?.category || "";
  $("chTier").value = String(ch?.tier || "pro").toLowerCase() === "free" ? "free" : "pro";
  $("chPreview").value = ch?.previewVideoUrl || "";
  $("chOrder").value = ch?.order ?? STATE.channels.length;
  m.hidden = false;
}
async function saveChannelModal() {
  try {
    const id = $("chId").value.trim();
    const payload = {
      id: id || undefined,
      name: $("chName").value.trim(), url: $("chUrl").value.trim(),
      logo: $("chLogo").value.trim(), category: $("chGroup").value.trim(),
      tier: $("chTier").value, previewVideoUrl: $("chPreview").value.trim(),
      order: Number($("chOrder").value) || 0
    };
    if (!payload.name || !payload.url) return toast("Name aur URL zaroori hain", "error");
    const r = await apiPost(id ? "admin/channel/update" : "admin/channel/create", payload);
    toast(id ? "✎ Channel updated" : "＋ Channel added");
    $("chModal").hidden = true;
    await loadChannels();
  } catch (e) { toast(e.message, "error"); }
}

/* ---- import modal (M3U / bulk / JSON) ---- */
function openImportModal(mode) {
  const m = $("impModal"); if (!m) return;
  $("impMode").value = mode;
  setText("impTitle", mode === "m3u" ? "🎵 M3U import" : "📥 Bulk import");
  $("impResult").textContent = "";
  m.hidden = false;
  setTimeout(() => $("impText")?.focus(), 50);
}
async function runImport(previewOnly) {
  const mode = $("impMode").value;
  const text = $("impText").value;
  if (!text.trim()) return toast("Pehle data paste karo", "error");
  const action = mode === "m3u" ? "admin/channel/m3u-import" : "admin/channel/bulk-import";
  try {
    const r = await apiPost(action, { text, previewOnly, replace: $("impReplace").checked });
    const out = $("impResult");
    if (r.preview) {
      out.textContent = `👁 Preview: ${r.count} channels parse hue —\n` + r.sample.map((c) => "• " + c.name + "  →  " + c.url.slice(0, 60)).join("\n");
    } else {
      out.textContent = r.message || JSON.stringify(r);
      toast(r.message || "Import done");
      $("impModal").hidden = true;
      await loadChannels();
    }
  } catch (e) {
    $("impResult").textContent = "❌ " + e.message;
    toast(e.message, "error");
  }
}

async function loadPlaylists() {
  const list = (await dbRead("playlists", [])) || [];
  STATE.playlists = Array.isArray(list) ? list : Object.values(list);
  setText("badgePlaylists", STATE.playlists.length);
  setText("kpiPlaylists", STATE.playlists.length);
  const tb = $("plBody"); if (!tb) return;
  tb.innerHTML = STATE.playlists.map((p) => `<tr data-row><td><b>${esc(p.name || p.title || "Playlist")}</b><br><span class="mono" style="color:var(--dim)">${esc(p.url || "")}</span></td><td>${esc(p.type || "m3u")}</td><td>${esc(p.updatedAt || "")}</td></tr>`).join("") || '<tr><td style="color:var(--dim)">No playlists.</td></tr>';
}
async function loadXtream() {
  const d = await apiGet("admin/xtream-accounts");
  STATE.xtream = d.accounts || [];
  setText("badgeXtream", STATE.xtream.length);
  setText("kpiXtream", STATE.xtream.length);
  const active = STATE.xtream.filter((a) => String(a.status) === "Active").length;
  setText("kpiXtreamSub", `${active} Active • ${STATE.xtream.length - active} other`);
  renderXtream();
}
function renderXtream() {
  const tb = $("xtBody"); if (!tb) return;
  const q = STATE.search.toLowerCase();
  tb.innerHTML = STATE.xtream.filter((a) => !q || a.username.toLowerCase().includes(q)).map((a) => {
    const exp = Number(a.expDate || 0);
    const expStr = exp ? new Date(exp * 1000).toLocaleDateString() : "—";
    const st = String(a.status || "Active") === "Active" ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Suspended</span>';
    return `<tr data-row><td><b>${esc(a.username)}</b></td><td class="mono">${esc(a.password)}</td><td class="mono">${esc(a.mac || "—")}</td><td>${st}</td><td>${expStr}</td>
      <td><button class="btn btn-ghost btn-sm" data-xt-renew="${esc(a.username)}">🔄</button>
      <button class="btn btn-ghost btn-sm" data-xt-susp="${esc(a.username)}">⏸</button>
      <button class="btn btn-danger btn-sm" data-xt-del="${esc(a.username)}">🗑</button></td></tr>`;
  }).join("") || '<tr><td colspan="6" style="color:var(--dim)">No Xtream accounts.</td></tr>';
}
async function loadMovies() {
  const d = await fetch("/api/embed?action=movies&limit=40").then((r) => r.json()).catch(() => ({}));
  STATE.movies = d.movies || [];
  renderList("mvBody", STATE.movies, (m) => `<td><b>${esc(m.title)}</b></td><td>${esc(m.year || "")}</td><td>⭐ ${esc(m.rating || "—")}</td>`);
}
async function loadSeries() {
  const d = await fetch("/api/embed?action=series&limit=40").then((r) => r.json()).catch(() => ({}));
  STATE.series = d.series || [];
  renderList("srBody", STATE.series, (m) => `<td><b>${esc(m.title)}</b></td><td>${esc(m.year || "")}</td><td>⭐ ${esc(m.rating || "—")}</td>`);
}
function renderList(tbodyId, list, rowFn) {
  const tb = $(tbodyId); if (!tb) return;
  const q = STATE.search.toLowerCase();
  tb.innerHTML = list.filter((m) => !q || String(m.title || "").toLowerCase().includes(q)).map((m) => `<tr data-row>${rowFn(m)}</tr>`).join("") || '<tr><td style="color:var(--dim)">Empty.</td></tr>';
}
async function loadUsers() {
  const d = await apiGet("admin/clients");
  STATE.clients = d.clients || [];
  const tb = $("usBody"); if (!tb) return;
  const q = STATE.search.toLowerCase();
  tb.innerHTML = STATE.clients.filter((c) => !q || c.username.includes(q) || (c.mac || "").includes(q)).map((c) => {
    const st = c.status === "suspended" ? '<span class="pill bad">Suspended</span>' : c.expired ? '<span class="pill warn">Expired</span>' : '<span class="pill ok">Active</span>';
    const mac = c.mac ? `<span class="mono">${esc(c.mac)}</span> 🛰️` : '<span style="color:var(--dim)">—</span>';
    return `<tr data-row><td><b>${esc(c.username)}</b></td><td>${esc(c.whatsapp || "—")}</td><td>${mac}</td><td>${esc(c.resellerCode || "direct")}</td><td>${st}</td><td>${c.daysLeft}</td>
      <td><button class="btn btn-ghost btn-sm" data-bind-mac="${esc(c.username)}">${c.mac ? "🔄 Re-MAC" : "🛰️ Bind MAC"}</button></td></tr>`;
  }).join("") || '<tr><td colspan="7" style="color:var(--dim)">No clients.</td></tr>';
}
async function loadSettings() {
  const d = await apiGet("admin/settings");
  const s = d.settings || {};
  const map = { stWelcome: "welcomeVideoUrl", stOffline: "channelOfflineVideoUrl", stComing: "comingSoonVideoUrl", stPro: "proUnlockVideoUrl", stWa: "proWhatsapp", stTicker: "siteAnnouncement" };
  for (const [id, key] of Object.entries(map)) { const el = $(id); if (el) el.value = s[key] || ""; }
}
async function loadAnalytics() {
  const d = await apiGet("admin/analytics");
  const a = d.analytics || {};
  setText("anOnline", a.onlineNow ?? 0);
  setText("anSessions", a.totalSessions ?? 0);
  setText("anPlays", a.totalPlays ?? 0);
  setText("anAvg", Math.round((a.avgSessionSec || 0) / 60) + " min");
  const d2 = await apiGet("admin/errors", { limit: 20 });
  const tb = $("errBody"); if (tb) tb.innerHTML = (d2.errors || []).map((e) => `<tr><td class="mono" style="max-width:420px">${esc(e.message)}</td><td>${esc(e.route || "")}</td><td>${esc(e.at || "")}</td></tr>`).join("") || '<tr><td style="color:var(--dim)">No errors 🎉</td></tr>';
}
async function loadResellers() {
  const d = await apiGet("admin/resellers");
  STATE.resellers = d.resellers || [];
  const tb = $("rsBody"); if (!tb) return;
  tb.innerHTML = STATE.resellers.map((r) => {
    const st = r.status === "suspended" ? '<span class="pill bad">Suspended</span>' : '<span class="pill ok">Active</span>';
    return `<tr data-row><td class="mono"><b>${esc(r.code)}</b></td><td>${esc(r.name || "")}<br><span style="color:var(--dim);font-size:.7rem">${esc(r.email || "")}</span></td><td>${r.credits}</td><td>${st}</td>
      <td><button class="btn btn-primary btn-sm" data-rs-topup="${esc(r.code)}">+10 💳</button></td></tr>`;
  }).join("") || '<tr><td colspan="5" style="color:var(--dim)">No resellers yet — self-serve signup se aayenge.</td></tr>';
}
async function loadOrders() {
  const d = await apiGet("admin/orders");
  STATE.orders = d.orders || [];
  const tb = $("orBody"); if (!tb) return;
  tb.innerHTML = STATE.orders.map((o) => {
    const st = o.status === "approved" ? '<span class="pill ok">Approved</span>' : o.status === "rejected" ? '<span class="pill bad">Rejected</span>' : '<span class="pill warn">Pending</span>';
    const act = o.status === "pending" ? `<button class="btn btn-primary btn-sm" data-or-approve="${esc(o.id)}">✅</button> <button class="btn btn-danger btn-sm" data-or-reject="${esc(o.id)}">✖</button>` : esc(o.clientUsername || "");
    return `<tr data-row><td class="mono">${esc(o.id)}</td><td>${esc(o.name)}<br><span style="color:var(--dim);font-size:.7rem">${esc(o.whatsapp || "")}</span></td><td>${esc(o.planId)}</td><td>Rs ${o.amount || "—"}</td><td>${st}</td><td>${act}</td></tr>`;
  }).join("") || '<tr><td colspan="6" style="color:var(--dim)">No orders.</td></tr>';
}
async function loadStalker() {
  const d = await apiGet("admin/stalker/list");
  STATE.stalker = d.clients || [];
  setText("portalUrl", location.origin + "/portal.php");
  const tb = $("stBody"); if (!tb) return;
  tb.innerHTML = STATE.stalker.map((c) => {
    const st = c.status === "suspended" || c.expired ? '<span class="pill bad">Blocked</span>' : '<span class="pill ok">Active</span>';
    return `<tr data-row><td class="mono">${esc(c.mac)}</td><td>${esc(c.username)}</td><td>${st}</td><td>${c.expDate ? new Date(c.expDate * 1000).toLocaleDateString() : "—"}</td></tr>`;
  }).join("") || '<tr><td colspan="4" style="color:var(--dim)">No MAG clients yet.</td></tr>';
}
async function loadApiKeys() {
  const d = await apiGet("admin/api-keys");
  STATE.keys = d.keys || [];
  const tb = $("keyBody"); if (!tb) return;
  tb.innerHTML = STATE.keys.map((k) => {
    const st = k.revoked ? '<span class="pill bad">Revoked</span>' : '<span class="pill ok">Active</span>';
    return `<tr data-row><td>${esc(k.label)}</td><td>${esc((k.createdAt || "").slice(0, 10))}</td><td>${esc(k.lastUsedAt ? new Date(Number(k.lastUsedAt)).toLocaleString() : "—")}</td><td>${st}</td>
      <td>${k.revoked ? "" : `<button class="btn btn-danger btn-sm" data-key-revoke="${esc(k.hash || k.id)}">Revoke</button>`}</td></tr>`;
  }).join("") || '<tr><td colspan="5" style="color:var(--dim)">No API keys.</td></tr>';
}
async function loadAudit() {
  const d = await apiGet("admin/audit", { limit: 12 });
  STATE.audit = d.audit || [];
  const tb = $("actBody"); if (!tb) return;
  tb.innerHTML = STATE.audit.map((a) => `<tr><td style="color:var(--dim);font-size:.72rem">${esc((a.at || "").slice(0, 19).replace("T", " "))}</td><td>${esc(a.action)}</td><td class="mono" style="font-size:.72rem">${esc(JSON.stringify(a.detail || {}).slice(0, 90))}</td></tr>`).join("") || '<tr><td style="color:var(--dim)">No activity.</td></tr>';
}

/* ---------- controls ---------- */
function appInit() {
  if (window.__mzAdminInit) return;
  window.__mzAdminInit = true;

  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => safe("switchTab", () => switchTab(b.dataset.tab))));

  const gs = $("globalSearch");
  if (gs) gs.addEventListener("input", (e) => {
    STATE.search = e.target.value;
    safe("renderChannels", renderChannels); safe("renderXtream", renderXtream);
    ["mvBody", "srBody", "usBody"].forEach((id) => safe("render" + id, () => { const tb = $(id); }));
    safe("loadMovies", loadMovies); safe("loadSeries", loadSeries); safe("loadUsers", loadUsers);
  });
  for (const id of ["chSearch", "xtSearch", "mvSearch", "srSearch", "usSearch"]) {
    const el = $(id);
    if (el) el.addEventListener("input", (e) => {
      STATE.search = e.target.value;
      safe("renderChannels", renderChannels); safe("renderXtream", renderXtream);
      safe("loadMovies", loadMovies); safe("loadSeries", loadSeries); safe("loadUsers", loadUsers);
    });
  }

  $("lockGoogleBtn")?.addEventListener("click", async () => {
    lockErr("");
    const b = $("lockGoogleBtn"); if (b) b.disabled = true;
    const res = await safe("loginWithGoogle", () => loginWithGoogle()) || { ok: false, error: "failed" };
    if (b) b.disabled = false;
    if (!res.ok) {
      const hint = res.code === "auth/unauthorized-domain" ? ` — Firebase → Auth → Authorized domains mein ${location.hostname} add karo, ya Owner PIN use karo.` : "";
      lockErr((res.error || "Google sign-in failed") + hint);
    }
  });
  $("lockGoogleRedirectBtn")?.addEventListener("click", () => { lockErr("Redirecting…"); safe("redirect", () => loginWithGoogleRedirect()); });
  $("lockPinBtn")?.addEventListener("click", () => pinLogin($("lockPinIn")?.value.trim()));
  $("lockPinIn")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("lockPinBtn")?.click(); });

  $("btnLogout")?.addEventListener("click", async () => {
    await safe("logout", logoutUser);
    localStorage.removeItem("mz_admin_session");
    localStorage.removeItem("mz_admin_key");
    location.reload();
  });
  $("btnTheme")?.addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    localStorage.setItem("mz_theme", next);
    setText("btnTheme", next === "dark" ? "🌙" : "☀️");
  });
  safe("theme", () => {
    const t = localStorage.getItem("mz_theme");
    if (t) { document.documentElement.dataset.theme = t; setText("btnTheme", t === "dark" ? "🌙" : "☀️"); }
  });

  $("stRefreshBtn")?.addEventListener("click", () => safe("loadStalker", loadStalker));
  $("errRefresh")?.addEventListener("click", () => safe("loadAnalytics", loadAnalytics));
  $("stSave")?.addEventListener("click", async () => {
    try {
      await apiPost("admin/settings-set", {
        patch: {
          welcomeVideoUrl: $("stWelcome")?.value, channelOfflineVideoUrl: $("stOffline")?.value,
          comingSoonVideoUrl: $("stComing")?.value, proUnlockVideoUrl: $("stPro")?.value,
          proWhatsapp: $("stWa")?.value, siteAnnouncement: $("stTicker")?.value
        }
      });
      toast("💾 Settings saved");
    } catch (e) { toast(e.message, "error"); }
  });
  $("keyCreateBtn")?.addEventListener("click", async () => {
    try {
      const r = await apiPost("admin/api-key-create", { label: "panel-" + new Date().toISOString().slice(0, 10), expiresDays: 0 });
      const card = $("keyNewCard"), pre = $("keyNewValue");
      if (card) card.hidden = false;
      if (pre) pre.textContent = r.apiKey;
      toast("🔑 API key created — copy kar lo!");
      safe("loadApiKeys", loadApiKeys);
    } catch (e) { toast(e.message, "error"); }
  });
  $("chAddBtn")?.addEventListener("click", () => openChannelModal(null));
  $("chBulkBtn")?.addEventListener("click", () => openImportModal("bulk"));
  $("chM3uBtn")?.addEventListener("click", () => openImportModal("m3u"));
  $("chSaveOrderBtn")?.addEventListener("click", async () => {
    try {
      const ids = STATE.channels.map((c) => c.id);
      await apiPost("admin/channel/reorder", { ids });
      toast("💾 Order saved (" + ids.length + " channels)");
      await loadChannels();
    } catch (e) { toast(e.message, "error"); }
  });
  $("chModalClose")?.addEventListener("click", () => { $("chModal").hidden = true; });
  $("chModalSave")?.addEventListener("click", () => safe("saveChannelModal", saveChannelModal));
  $("impClose")?.addEventListener("click", () => { $("impModal").hidden = true; });
  $("impPreviewBtn")?.addEventListener("click", () => safe("runImport", () => runImport(true)));
  $("impGoBtn")?.addEventListener("click", () => safe("runImport", () => runImport(false)));
  $("copyPortalBtn")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("portalUrl")?.textContent || location.origin + "/portal.php"); toast("📋 Portal URL copied"); }
    catch { toast("Copy manually karo: " + ($("portalUrl")?.textContent || ""), "error"); }
  });
  $("xtAddBtn")?.addEventListener("click", async () => {
    try {
      const r = await apiPost("admin/xtream/create", { name: "user" + Date.now() % 100000, days: 30, planId: "monthly" });
      toast("⚡ Xtream user created: " + r.client.username);
      safe("loadXtream", loadXtream); safe("loadUsers", loadUsers);
    } catch (e) { toast(e.message, "error"); }
  });
  $("qGo")?.addEventListener("click", () => { STATE.search = $("qSearch")?.value || ""; switchTab("channels"); });

  // delegated row actions
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-rs-topup],[data-or-approve],[data-or-reject],[data-key-revoke],[data-xt-renew],[data-xt-susp],[data-xt-del],[data-ch-edit],[data-ch-del],[data-bind-mac]");
    if (!el) return;
    try {
      if (el.dataset.rsTopup) { await apiPost("admin/credits-topup", { code: el.dataset.rsTopup, credits: 10 }); toast("+10 credits"); safe("loadResellers", loadResellers); }
      else if (el.dataset.orApprove) { const r = await apiPost("admin/order-review", { id: el.dataset.orApprove, approve: true }); toast("✅ Approved — client: " + (r.client?.username || "")); safe("loadOrders", loadOrders); safe("loadXtream", loadXtream); }
      else if (el.dataset.orReject) { await apiPost("admin/order-review", { id: el.dataset.orReject, approve: false }); toast("Order rejected"); safe("loadOrders", loadOrders); }
      else if (el.dataset.keyRevoke) { await apiPost("admin/api-key-revoke", { hash: el.dataset.keyRevoke }); toast("Key revoked 🚫"); safe("loadApiKeys", loadApiKeys); }
      else if (el.dataset.xtRenew) { await apiPost("admin/xtream/renew", { username: el.dataset.xtRenew }); toast("🔄 renewed"); safe("loadXtream", loadXtream); }
      else if (el.dataset.xtSusp) { await apiPost("admin/xtream/suspend", { username: el.dataset.xtSusp }); toast("⏸ suspended"); safe("loadXtream", loadXtream); }
      else if (el.dataset.xtDel) { await apiPost("admin/xtream/delete", { username: el.dataset.xtDel }); toast("🗑 deleted"); safe("loadXtream", loadXtream); safe("loadUsers", loadUsers); }
      else if (el.dataset.chEdit) { const ch = STATE.channels.find((c) => c.id === el.dataset.chEdit); openChannelModal(ch); }
      else if (el.dataset.chDel) {
        if (!confirm("Channel delete kar dein?")) return;
        await apiPost("admin/channel/delete", { id: el.dataset.chDel });
        toast("🗑 Channel deleted"); safe("loadChannels", loadChannels);
      }
      else if (el.dataset.bindMac) {
        const r = await apiPost("admin/client-bind-mac", { username: el.dataset.bindMac });
        toast(`🛰️ MAC bound: ${r.mac} — portal: ${r.portal}`);
        safe("loadUsers", loadUsers); safe("loadStalker", loadStalker);
      }
    } catch (err) { toast(err.message, "error"); }
  });
}

/* ---------- boot ---------- */
(async () => {
  safe("appInit", appInit);                 // controls bound FIRST — panel kabhi dead nahi
  safe("subscribeAuth", () => subscribeAuth((u) => { safe("onAuthUser", () => onAuthUser(u)); }));
  // redirect result (Google redirect sign-in)
  safe("finishRedirect", async () => { const r = await finishRedirect(); if (r?.ok) await onAuthUser({ email: r.user.email, displayName: r.user.displayName || "", uid: r.user.uid }); });
  // existing PIN session?
  if (adminToken()) {
    await enterAdmin({ displayName: "Owner (PIN)", email: ADMIN_EMAIL, uid: "owner_pin" });
  } else {
    showLock();
  }
})().catch((err) => {
  console.error("boot failed", err);
  safe("showLock", () => showLock("Boot error: " + (err?.message || err)));
});
