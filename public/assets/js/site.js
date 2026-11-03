/* Mizanora IPTV v6 — animated catalog, intro player, EPG, trials and recharge. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = String(value ?? ""); };
  function toast(message, error = false) {
    const item = $("toast");
    if (!item) return;
    item.textContent = String(message);
    item.className = "toast show" + (error ? " err" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { item.className = "toast"; }, 4500);
  }
  function sessionId() {
    try {
      let id = sessionStorage.getItem("mz_session");
      if (!id) { id = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now(); sessionStorage.setItem("mz_session", id); }
      return id;
    } catch { return "web-session"; }
  }
  function track(event, route) {
    const payload = JSON.stringify({ action: "track", event, route: route || location.pathname, sessionId: sessionId() });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/panel", new Blob([payload], { type: "application/json" }));
      else fetch("/api/panel", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    } catch { /* Analytics never blocks playback. */ }
  }

  /* ---------- public experience / animated channel catalog ---------- */
  let experience = {
    intro: { enabled: true, url: "/media/welcome/video.mp4", durationSec: 8, skippable: false },
    branding: { service: "Mizanora IPTV", business: "Start your IPTV reseller business", paymentMethod: "JazzCash", paymentAccount: "03062015326", paymentTitle: "Muaaz Iqbal", support: "03062015326" },
    videos: { offline: "/media/channel-offline/index.m3u8", comingSoon: "/media/coming-soon/index.m3u8", recharge: "/media/pro-unlock/index.m3u8" },
    announcement: "", rechargeNote: "Apne reseller ya Mizanora support se recharge karein.", resellerContactNote: ""
  };
  let channels = [];
  let guide = [];
  let visibleChannels = 36;
  async function loadExperience() {
    try {
      const response = await fetch("/api/embed?action=config");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Config unavailable");
      experience = {
        ...experience, ...(data.experience || {}),
        intro: { ...experience.intro, ...(data.experience?.intro || {}) },
        videos: { ...experience.videos, ...(data.experience?.videos || {}) },
        pro: { ...(data.experience?.pro || {}) },
        branding: { ...experience.branding, ...(data.experience?.branding || {}) }
      };
      const resellerCode = new URLSearchParams(location.search).get("reseller");
      if (resellerCode) {
        try {
          const brandResponse = await fetch("/api/embed?action=branding&reseller=" + encodeURIComponent(resellerCode));
          const brandData = await brandResponse.json();
          if (brandResponse.ok && brandData.ok) {
            const incoming = brandData.branding || {};
            experience.branding = { ...experience.branding, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => String(value || "").trim())) };
          }
        } catch { /* Owner branding remains the safe fallback. */ }
      }
      updateBrandingText();
      setText("announcementText", experience.announcement || "");
      if ($("announcementBar")) $("announcementBar").hidden = !experience.announcement;
      setText("rechargeNote", experience.rechargeNote || "Apne reseller ya support se recharge karein.");
      setText("resellerContactNote", experience.resellerContactNote || "Reseller account aur top-up ke liye support se rabta karein.");
      const international = String(experience.pro?.whatsappIntl || "923062015326").replace(/\D/g, "");
      document.querySelectorAll("[data-pro-whatsapp]").forEach((link) => { link.href = `https://wa.me/${international}`; });
    } catch { /* Safe local defaults keep the welcome channel usable. */ }
  }
  function updateBrandingText() {
    const brand = experience.branding || {};
    setText("introService", String(brand.service || "Mizanora IPTV").toUpperCase());
    setText("introBusiness", brand.business || "Start your IPTV reseller business");
    setText("introPayment", [brand.paymentMethod, brand.paymentAccount, brand.paymentTitle].filter(Boolean).join(" · "));
    setText("introSupport", brand.support ? `WhatsApp / recharge: ${brand.support}` : "Contact your reseller to recharge");
    setText("fallbackContact", [brand.business, [brand.paymentMethod, brand.paymentAccount, brand.paymentTitle].filter(Boolean).join(" · "), brand.support ? `WhatsApp ${brand.support}` : ""].filter(Boolean).join(" · "));
  }
  function filteredChannels() {
    const query = String($("channelSearch")?.value || "").trim().toLowerCase();
    const category = String($("channelCategory")?.value || "");
    const sort = $("channelSort")?.value || "order";
    const list = channels.filter((channel) => {
      const haystack = `${channel.name} ${channel.category || ""} ${channel.nowPlaying || ""}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!category || channel.category === category);
    });
    return list.sort((a, b) => sort === "number" ? Number(a.channelNumber || a.streamId) - Number(b.channelNumber || b.streamId) : sort === "name" ? a.name.localeCompare(b.name) : sort === "category" ? String(a.category).localeCompare(String(b.category)) || a.name.localeCompare(b.name) : Number(a.order || 0) - Number(b.order || 0));
  }
  function renderChannels() {
    const grid = $("chGrid");
    if (!grid) return;
    const list = filteredChannels();
    const visible = list.slice(0, visibleChannels);
    grid.innerHTML = visible.map((channel, index) => `<button class="ch channel-enter" style="--delay:${Math.min(index, 18) * 35}ms" type="button" data-channel="${esc(channel.id)}" aria-label="Play ${esc(channel.name)}">${channel.logo ? `<img src="${esc(channel.logo)}" alt="" loading="lazy">` : '<span class="ch-icon" aria-hidden="true">📺</span>'}<span class="channel-number">${Number(channel.channelNumber) || Number(channel.streamId) || ""}</span><span class="ch-copy"><b>${esc(channel.name)}</b><small>${esc(channel.nowPlaying || channel.category || "Live TV")}</small></span><em class="access ${channel.tier === "pro" ? "pro" : ""}">${channel.status === "offline" ? "OFFLINE" : channel.tier === "pro" ? "PRO" : "▶ FREE"}</em></button>`).join("") || '<div class="ch"><span>No matching channels. Try another search.</span></div>';
    if ($("chLoadMore")) $("chLoadMore").hidden = visible.length >= list.length;
    setText("channelResultCount", `${list.length} channel${list.length === 1 ? "" : "s"}`);
  }
  async function loadChannels() {
    try {
      const response = await fetch("/api/embed?action=channels");
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.channels)) throw new Error(data.error || "Channels list load nahi hui");
      channels = data.channels;
      setText("stChannels", data.count);
      const categories = [...new Set(channels.map((channel) => channel.category).filter(Boolean))].sort();
      if ($("channelCategory")) $("channelCategory").innerHTML = '<option value="">All categories</option>' + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("");
      if ($("guideChannel")) $("guideChannel").innerHTML = '<option value="">All channels</option>' + channels.map((channel) => `<option value="${esc(channel.id)}">${esc(channel.name)}</option>`).join("");
      renderChannels();
    } catch (error) {
      if ($("chGrid")) $("chGrid").innerHTML = `<div class="ch"><span>${esc(error.message)} — refresh karke dobara try karein.</span></div>`;
      setText("stChannels", "—");
    }
  }

  /* ---------- EPG now / next guide ---------- */
  const timeLabel = (value) => value ? new Date(Number(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  function programmeHtml(programme, label) {
    if (!programme) return "";
    return `<div class="programme"><span>${label} · ${timeLabel(programme.start)}–${timeLabel(programme.stop)}</span><b>${esc(programme.title)}</b>${programme.category ? `<small>${esc(programme.category)}</small>` : ""}</div>`;
  }
  function renderGuide() {
    const grid = $("guideGrid");
    if (!grid) return;
    const selected = String($("guideChannel")?.value || "");
    const entries = (selected ? guide.filter((entry) => entry.channel.id === selected) : guide).slice(0, selected ? 1 : 36);
    grid.innerHTML = entries.map((entry) => {
      const fallback = !entry.now && entry.channel.nowPlaying ? `<div class="programme fallback"><span>CHANNEL INFO</span><b>${esc(entry.channel.nowPlaying)}</b><small>Timed EPG not available</small></div>` : "";
      const empty = !entry.now && !entry.next && !fallback ? '<div class="programme fallback"><b>No EPG data yet</b><small>Owner can import XMLTV from Admin → EPG Guide.</small></div>' : "";
      return `<article class="guide-card"><div class="guide-channel">${entry.channel.logo ? `<img src="${esc(entry.channel.logo)}" alt="">` : "📺"}<b>${esc(entry.channel.name)}</b></div>${programmeHtml(entry.now, "NOW")}${fallback}${empty}${programmeHtml(entry.next, "NEXT")}</article>`;
    }).join("") || '<div class="card"><p>No guide channels found.</p></div>';
  }
  async function loadGuide() {
    setText("guideStatus", "Loading now/next guide…");
    try {
      const response = await fetch("/api/embed?action=guide&limit=200");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Guide unavailable");
      guide = data.guide || [];
      setText("guideStatus", data.sources ? `${data.sources} XMLTV source${data.sources === 1 ? "" : "s"} · updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "recently"}` : "Channel info available · import XMLTV for timed programmes");
      renderGuide();
    } catch (error) { setText("guideStatus", error.message); }
  }

  /* ---------- intro → secure fetch → live player ---------- */
  let hls = null;
  let currentChannel = null;
  let playerRequest = 0;
  let introFinish = null;
  let introActive = false;
  let playerMode = "idle";
  let liveWatchdog = null;
  let liveRecoveryTimer = null;
  let introCountdownTimer = null;
  const video = $("liveVideo");
  function playerStatus(message, error = false) {
    const status = $("playerStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("err", error);
  }
  function destroyVideo() {
    clearTimeout(liveWatchdog); clearTimeout(liveRecoveryTimer);
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    if (video) { video.pause(); video.loop = false; video.removeAttribute("src"); video.load(); }
  }
  function closePlayer() {
    playerRequest++;
    if (introFinish) introFinish();
    destroyVideo();
    introActive = false;
    playerMode = "idle";
    if ($("introOverlay")) $("introOverlay").hidden = true;
    if ($("fallbackOverlay")) $("fallbackOverlay").hidden = true;
    if ($("playerRecharge")) $("playerRecharge").hidden = true;
    clearInterval(introCountdownTimer);
    if ($("playerSkip")) $("playerSkip").hidden = true;
    const dialog = $("playerDialog");
    if (dialog?.hasAttribute("open")) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }
  function playIntro(request) {
    const intro = experience.intro || {};
    if (!intro.enabled || !intro.url || request !== playerRequest || !video) return Promise.resolve();
    const durationSec = Math.max(1, Math.min(30, Number(intro.durationSec) || 8));
    introActive = true;
    playerMode = "intro";
    video.loop = true;
    updateBrandingText();
    setText("introChannel", currentChannel?.name || "Live TV");
    setText("introChannelMeta", `Channel ${Number(currentChannel?.channelNumber) || Number(currentChannel?.streamId) || "—"} · starting in ${durationSec}s`);
    setText("introCountdown", durationSec);
    let remaining = durationSec;
    clearInterval(introCountdownTimer);
    introCountdownTimer = setInterval(() => { remaining = Math.max(0, remaining - 1); setText("introCountdown", remaining); setText("introChannelMeta", `Channel ${Number(currentChannel?.channelNumber) || Number(currentChannel?.streamId) || "—"} · starting in ${remaining}s`); }, 1000);
    if ($("introOverlay")) {
      $("introOverlay").hidden = false;
      $("introOverlay").style.setProperty("--intro-duration", `${durationSec}s`);
    }
    if ($("playerSkip")) $("playerSkip").hidden = intro.skippable === false;
    playerStatus("✨ Mizanora welcome intro — your channel is next…");
    return new Promise((resolve) => {
      let settled = false;
      const onEnded = () => { if (request === playerRequest) { video.currentTime = 0; video.play().catch(() => {}); } };
      const onError = () => { if (request === playerRequest) playerStatus("Intro video unavailable — animated welcome continues; your channel is next."); };
      const timer = setTimeout(() => finish(), durationSec * 1000);
      function cleanup() {
        clearTimeout(timer);
        clearInterval(introCountdownTimer);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
        introActive = false;
        introFinish = null;
        if ($("introOverlay")) $("introOverlay").hidden = true;
        if ($("playerSkip")) $("playerSkip").hidden = true;
        destroyVideo();
      }
      function finish() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }
      introFinish = finish;
      video.addEventListener("ended", onEnded);
      video.addEventListener("error", onError);
      const isHls = /\.m3u8(?:$|\?)/i.test(intro.url);
      if (isHls && window.Hls?.isSupported()) {
        hls = new window.Hls({ enableWorker: true, manifestLoadingTimeOut: 8000 });
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data?.fatal) onError(); });
        hls.loadSource(intro.url);
        hls.attachMedia(video);
      } else {
        video.src = intro.url;
        video.load();
        video.play().catch(() => { if (request === playerRequest) playerStatus("Press play to watch the intro, or wait for your channel."); });
      }
    });
  }
  function showFallback(kind, message, request) {
    if (!video || request !== playerRequest) return;
    destroyVideo();
    playerMode = "fallback";
    if ($("introOverlay")) $("introOverlay").hidden = true;
    if ($("fallbackOverlay")) {
      $("fallbackOverlay").hidden = false;
      setText("fallbackBadge", kind === "offline" ? "CHANNEL OFFLINE" : kind === "recharge" ? "RECHARGE YOUR ACCOUNT" : "MOVIES & SERIES");
      setText("fallbackChannel", currentChannel?.name || "Mizanora IPTV");
      updateBrandingText();
    }
    if ($("playerRecharge")) $("playerRecharge").hidden = kind === "comingSoon";
    const url = experience.videos?.[kind];
    playerStatus(message, kind !== "comingSoon");
    if ($("playerRetry")) $("playerRetry").hidden = kind !== "offline";
    video.hidden = !url;
    if (!url) return;
    video.loop = true;
    if (/\.m3u8(?:$|\?)/i.test(url) && window.Hls?.isSupported()) {
      hls = new window.Hls({ enableWorker: true, manifestLoadingTimeOut: 8000 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { if (request === playerRequest) video.play().catch(() => {}); });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal && request === playerRequest && playerMode === "fallback") playerStatus(message + " Fallback video unavailable.", true);
      });
      hls.loadSource(url); hls.attachMedia(video);
    } else {
      video.src = url; video.load(); video.play().catch(() => {});
    }
  }
  function attachStream(url, request) {
    if (!video || request !== playerRequest) return;
    destroyVideo();
    playerMode = "live";
    playerStatus("Loading secure live stream…");
    if ($("fallbackOverlay")) $("fallbackOverlay").hidden = true;
    let started = false;
    const onPlaying = () => { if (request === playerRequest && playerMode === "live") { started = true; clearTimeout(liveWatchdog); } };
    video.addEventListener("playing", onPlaying, { once: true });
    clearTimeout(liveWatchdog);
    liveWatchdog = setTimeout(() => { video.removeEventListener("playing", onPlaying); if (!started && request === playerRequest && playerMode === "live") showFallback("offline", "Channel did not start in time. It may be offline or blocked by your browser.", request); }, 20000);
    const isHls = /\.m3u8(?:$|\?)/i.test(url) || url.includes("/s/");
    if (isHls && window.Hls?.isSupported()) {
      hls = new window.Hls({ enableWorker: true, backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 60, capLevelToPlayerSize: true, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, manifestLoadingTimeOut: 15000, levelLoadingTimeOut: 15000 });
      const liveHls = hls;
      let networkRetries = 0, mediaRetries = 0, recoveryWindow = Date.now();
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (request !== playerRequest || playerMode !== "live") return;
        playerStatus("Ready — press play if your browser paused autoplay.");
        video.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal || request !== playerRequest || playerMode !== "live") return;
        if (Date.now() - recoveryWindow > 60000) { networkRetries = 0; mediaRetries = 0; recoveryWindow = Date.now(); }
        if (data.type && data.type === window.Hls.ErrorTypes?.NETWORK_ERROR && networkRetries < 2 && typeof liveHls.startLoad === "function") {
          const delay = ++networkRetries * 1000;
          playerStatus("Connection interrupted — retrying stream…");
          clearTimeout(liveRecoveryTimer);
          liveRecoveryTimer = setTimeout(() => { if (request === playerRequest && hls === liveHls && playerMode === "live") liveHls.startLoad(); }, delay);
          return;
        }
        if (data.type && data.type === window.Hls.ErrorTypes?.MEDIA_ERROR && mediaRetries++ < 1 && typeof liveHls.recoverMediaError === "function") {
          clearTimeout(liveRecoveryTimer); playerStatus("Recovering video playback…"); liveHls.recoverMediaError(); return;
        }
        showFallback("offline", "Channel is offline or cannot be loaded after recovery attempts. Retry when available.", request);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.load();
      video.play().catch(() => { if (request === playerRequest && playerMode === "live") playerStatus("Ready — press play to start."); });
    }
  }
  async function fetchChannel(request) {
    try {
      const response = await fetch("/api/embed?action=stream&id=" + encodeURIComponent(currentChannel.id));
      const data = await response.json();
      if (request !== playerRequest) return;
      if (!response.ok || !data.ok) {
        if (response.status === 403) {
          if ($("playerPro")) $("playerPro").hidden = false;
          showFallback("recharge", "PRO subscription required — recharge or start a trial.", request);
          return;
        }
        throw new Error(data.error || "Stream unavailable");
      }
      attachStream(data.url, request);
      track("stream_play", "/channel/" + currentChannel.id);
    } catch (error) {
      if (request !== playerRequest) return;
      showFallback("offline", error.message || "Stream unavailable", request);
    }
  }
  async function openChannel(id, { skipIntro = false } = {}) {
    const channel = channels.find((item) => String(item.id) === String(id) || String(item.streamId) === String(id));
    if (!channel) return;
    const request = ++playerRequest;
    if (introFinish) introFinish();
    destroyVideo();
    currentChannel = channel;
    setText("playerTitle", channel.name);
    setText("playerGroup", channel.group || channel.category || "Live TV");
    if ($("playerPro")) $("playerPro").hidden = true;
    if ($("fallbackOverlay")) $("fallbackOverlay").hidden = true;
    if ($("playerRecharge")) $("playerRecharge").hidden = true;
    if ($("playerRetry")) $("playerRetry").hidden = true;
    if (video) video.hidden = false;
    playerStatus("Preparing your channel…");
    const dialog = $("playerDialog");
    if (dialog && !dialog.hasAttribute("open")) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!skipIntro) await playIntro(request);
    if (request !== playerRequest) return;
    await fetchChannel(request);
  }

  function openCinemaPreview() {
    const request = ++playerRequest;
    if (introFinish) introFinish();
    destroyVideo();
    currentChannel = null;
    setText("playerTitle", "Movies & Series");
    setText("playerGroup", "Coming soon");
    if ($("playerPro")) $("playerPro").hidden = true;
    const dialog = $("playerDialog");
    if (dialog && !dialog.hasAttribute("open")) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    showFallback("comingSoon", "Movies & Series — coming soon.", request);
  }

  /* ---------- movies / series catalog ---------- */
  const catalog = { kind: "movies", offset: 0, total: 0, request: 0 };
  async function loadCatalog() {
    const request = ++catalog.request;
    const params = new URLSearchParams({ action: catalog.kind, limit: "24", offset: String(catalog.offset), q: $("catalogSearch")?.value.trim() || "", sort: $("catalogSort")?.value || "title-asc", category: $("catalogCategory")?.value || "", ready: $("catalogReady")?.checked ? "1" : "" });
    setText("catalogStatus", "Loading catalog…");
    try {
      const response = await fetch("/api/embed?" + params); const data = await response.json();
      if (request !== catalog.request) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Catalog unavailable");
      catalog.total = Number(data.total || 0);
      const category = $("catalogCategory");
      if (category) { const value = category.value; category.innerHTML = '<option value="">All categories</option>' + (data.categories || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join(""); category.value = value; }
      const items = data[catalog.kind] || [];
      if ($("catalogGrid")) $("catalogGrid").innerHTML = items.map((item) => `<article class="catalog-card">${item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy">` : '<div class="catalog-poster-placeholder">🎬</div>'}<div><span class="catalog-meta">${esc(item.year || "")} · ⭐ ${esc(item.rating || "—")}</span><h3>${esc(item.title)}</h3><p>${esc(item.plot || item.category || "Mizanora catalog")}</p><span class="pill ${item.streamAvailable ? "ok" : "warn"}">${item.streamAvailable ? "Ready to play" : "Metadata only"}</span>${catalog.kind === "series" ? `<small>${Number(item.episodeCount || 0)} episodes</small>` : ""}<button class="btn btn-ghost btn-sm" data-catalog-play="${esc(item.id)}" type="button">${item.streamAvailable ? "▶ Play in IPTV app" : "ℹ Availability"}</button></div></article>`).join("") || '<div class="card">No matching titles. Try another search or filter.</div>';
      setText("catalogStatus", `${catalog.total ? catalog.offset + 1 : 0}–${Math.min(catalog.offset + 24, catalog.total)} of ${catalog.total} ${catalog.kind}. Licensed streams play in your IPTV app; metadata-only titles are not video.`);
      if ($("catalogPrev")) $("catalogPrev").disabled = catalog.offset === 0;
      if ($("catalogNext")) $("catalogNext").disabled = catalog.offset + 24 >= catalog.total;
    } catch (error) { if (request === catalog.request) setText("catalogStatus", error.message); }
  }
  function catalogTab(kind) { catalog.kind = kind; catalog.offset = 0; $("catalogMoviesTab")?.classList.toggle("active", kind === "movies"); $("catalogSeriesTab")?.classList.toggle("active", kind === "series"); if ($("catalogCategory")) $("catalogCategory").value = ""; loadCatalog(); }
  $("catalogMoviesTab")?.addEventListener("click", () => catalogTab("movies"));
  $("catalogSeriesTab")?.addEventListener("click", () => catalogTab("series"));
  let catalogSearchTimer;
  $("catalogSearch")?.addEventListener("input", () => { clearTimeout(catalogSearchTimer); catalogSearchTimer = setTimeout(() => { catalog.offset = 0; loadCatalog(); }, 250); });
  for (const id of ["catalogSort", "catalogCategory", "catalogReady"]) $(id)?.addEventListener("change", () => { catalog.offset = 0; loadCatalog(); });
  $("catalogPrev")?.addEventListener("click", () => { catalog.offset = Math.max(0, catalog.offset - 24); loadCatalog(); });
  $("catalogNext")?.addEventListener("click", () => { catalog.offset += 24; loadCatalog(); });
  $("catalogGrid")?.addEventListener("click", (event) => { const button = event.target.closest("[data-catalog-play]"); if (button) toast("Is title ki playback apne Xtream/M3U app mein kholen. Metadata-only title ke liye owner ko licensed stream URL set karna hoga."); });

  /* ---------- forms / recharge ---------- */
  function deviceId() {
    try {
      let id = localStorage.getItem("mz_dev");
      if (!id) { id = crypto.randomUUID?.() || Math.random().toString(36).slice(2); localStorage.setItem("mz_dev", id); }
      return id;
    } catch { return "web-" + Math.random().toString(36).slice(2); }
  }
  async function postJson(action, payload) {
    const response = await fetch("/api/panel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function busy(form, value) {
    const button = form?.querySelector('button[type="submit"]');
    if (button) { button.disabled = value; button.dataset.original ||= button.textContent; button.textContent = value ? "Please wait…" : button.dataset.original; }
  }

  /* ---------- controls ---------- */
  $("cinemaPreview")?.addEventListener("click", openCinemaPreview);
  $("chGrid")?.addEventListener("click", (event) => { const button = event.target.closest("[data-channel]"); if (button) openChannel(button.dataset.channel); });
  $("channelSearch")?.addEventListener("input", () => { visibleChannels = 36; renderChannels(); });
  $("channelCategory")?.addEventListener("change", () => { visibleChannels = 36; renderChannels(); });
  $("channelSort")?.addEventListener("change", () => { visibleChannels = 36; renderChannels(); });
  $("chLoadMore")?.addEventListener("click", () => { visibleChannels += 36; renderChannels(); });
  $("guideChannel")?.addEventListener("change", renderGuide);
  $("guideRefresh")?.addEventListener("click", loadGuide);
  $("playerClose")?.addEventListener("click", closePlayer);
  $("playerDialog")?.addEventListener("cancel", (event) => { event.preventDefault(); closePlayer(); });
  $("playerSkip")?.addEventListener("click", () => { if (introFinish) introFinish(); });
  $("playerRetry")?.addEventListener("click", () => { if (currentChannel) openChannel(currentChannel.id, { skipIntro: true }); });
  $("playerTrial")?.addEventListener("click", closePlayer);
  $("playerRecharge")?.addEventListener("click", closePlayer);
  $("playerDialog")?.addEventListener("click", (event) => { if (event.target === $("playerDialog")) closePlayer(); });
  video?.addEventListener("playing", () => {
    if (introActive) playerStatus("✨ Welcome intro — " + (currentChannel?.name || "channel") + " is loading…");
    else if (playerMode === "live") { playerStatus("● Live — playing"); if ($("playerRetry")) $("playerRetry").hidden = true; }
  });
  video?.addEventListener("waiting", () => { if (playerMode === "intro") playerStatus("Intro buffering…"); else if (playerMode === "live") playerStatus("Buffering…"); });
  video?.addEventListener("error", () => {
    if (introActive || !video || video.hidden || playerMode !== "live") return;
    showFallback("offline", "Playback failed. Check the source or retry.", playerRequest);
  });
  $("trialForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form, true);
    try {
      const data = await postJson("trial", { email: $("trialEmail").value.trim(), whatsapp: $("trialWa").value.trim(), deviceId: "web-" + deviceId() });
      const c = data.client;
      $("credOut").innerHTML = `<div class="card success-card"><h3>🔑 Aapke FREE Xtream Codes</h3><p><b>Server:</b> ${esc(location.origin)}<br><b>Username:</b> <code>${esc(c.username)}</code><br><b>Password:</b> <code>${esc(c.password)}</code></p><p class="credential-link"><b>M3U:</b> ${esc(data.links.m3u)}<br><b>EPG:</b> ${esc(data.links.epg)}</p><p>Expire: ${new Date(Number(c.expDate) * 1000).toLocaleString()}. Credentials kisi bhi compatible IPTV app mein use karein.</p></div>`;
      toast("🎁 Trial active! Credentials neeche hain.");
      $("credOut").scrollIntoView({ behavior: "smooth", block: "nearest" });
      track("trial_claim", "/trial");
    } catch (error) { toast(error.message, true); }
    finally { busy(form, false); }
  });
  $("orderForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form, true);
    try {
      const data = await postJson("order", { name: $("ordName").value.trim(), email: $("ordEmail").value.trim(), whatsapp: $("ordWa").value.trim(), planId: $("ordPlan").value, via: "whatsapp" });
      $("credOut").innerHTML = `<div class="card success-card"><h3>🧾 Order ${esc(data.order.id)}</h3><p>${esc(data.message)}</p><p><b>Amount:</b> Rs ${Number(data.order.amount || 0)}</p><p><a class="btn btn-gold btn-sm" href="${esc(data.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp par pay karein</a></p></div>`;
      toast("🧾 Order " + data.order.id + " receive ho gaya!");
      track("order_created", "/order/" + data.order.id);
    } catch (error) { toast(error.message, true); }
    finally { busy(form, false); }
  });
  $("rechargeForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form, true);
    try {
      const username = $("rechargeUsername").value.trim();
      const data = await postJson("recharge/contact", { username });
      const link = new URL(data.whatsapp);
      link.searchParams.set("text", `Assalam-o-Alaikum, Mizanora IPTV account ${username} recharge karna hai.`);
      $("rechargeOut").innerHTML = `<div class="recharge-result success-card"><h3>💳 Recharge contact ready</h3><p>${esc(data.message)}</p><a class="btn btn-gold" href="${esc(link.toString())}" target="_blank" rel="noopener">💬 ${esc(data.resellerName)} — WhatsApp</a></div>`;
    } catch (error) { $("rechargeOut").innerHTML = `<div class="recharge-result error-card">${esc(error.message)}</div>`; }
    finally { busy(form, false); }
  });

  (async function boot() {
    await loadExperience();
    await loadChannels();
    await loadGuide();
    await loadCatalog();
    const requested = new URLSearchParams(location.search).get("channel");
    if (requested) openChannel(requested);
    track("page_view", location.pathname + location.hash);
  })();
})();
