/* Mizanora IPTV v5 — animated catalog, intro player, EPG, trials and recharge. */
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
    intro: { enabled: true, url: "/media/welcome/video.mp4", durationSec: 4, skippable: true },
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
        pro: { ...(data.experience?.pro || {}) }
      };
      setText("announcementText", experience.announcement || "");
      if ($("announcementBar")) $("announcementBar").hidden = !experience.announcement;
      setText("rechargeNote", experience.rechargeNote || "Apne reseller ya support se recharge karein.");
      setText("resellerContactNote", experience.resellerContactNote || "Reseller account aur top-up ke liye support se rabta karein.");
      const international = String(experience.pro?.whatsappIntl || "923062015326").replace(/\D/g, "");
      document.querySelectorAll("[data-pro-whatsapp]").forEach((link) => { link.href = `https://wa.me/${international}`; });
    } catch { /* Safe local defaults keep the welcome channel usable. */ }
  }
  function filteredChannels() {
    const query = String($("channelSearch")?.value || "").trim().toLowerCase();
    const category = String($("channelCategory")?.value || "");
    return channels.filter((channel) => {
      const haystack = `${channel.name} ${channel.category || ""} ${channel.nowPlaying || ""}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!category || channel.category === category);
    });
  }
  function renderChannels() {
    const grid = $("chGrid");
    if (!grid) return;
    const list = filteredChannels();
    const visible = list.slice(0, visibleChannels);
    grid.innerHTML = visible.map((channel, index) => `<button class="ch channel-enter" style="--delay:${Math.min(index, 18) * 35}ms" type="button" data-channel="${esc(channel.id)}" aria-label="Play ${esc(channel.name)}">${channel.logo ? `<img src="${esc(channel.logo)}" alt="" loading="lazy">` : '<span class="ch-icon" aria-hidden="true">📺</span>'}<span class="ch-copy"><b>${esc(channel.name)}</b><small>${esc(channel.nowPlaying || channel.category || "Live TV")}</small></span><em class="access ${channel.tier === "pro" ? "pro" : ""}">${channel.tier === "pro" ? "PRO" : "▶ FREE"}</em></button>`).join("") || '<div class="ch"><span>No matching channels. Try another search.</span></div>';
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
  const video = $("liveVideo");
  function playerStatus(message, error = false) {
    const status = $("playerStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("err", error);
  }
  function destroyVideo() {
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
  }
  function closePlayer() {
    playerRequest++;
    if (introFinish) introFinish();
    destroyVideo();
    introActive = false;
    if ($("introOverlay")) $("introOverlay").hidden = true;
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
    const durationSec = Math.max(1, Math.min(30, Number(intro.durationSec) || 4));
    introActive = true;
    if ($("introOverlay")) {
      $("introOverlay").hidden = false;
      $("introOverlay").style.setProperty("--intro-duration", `${durationSec}s`);
    }
    if ($("playerSkip")) $("playerSkip").hidden = intro.skippable === false;
    playerStatus("✨ Mizanora welcome intro — your channel is next…");
    return new Promise((resolve) => {
      let settled = false;
      const onEnded = () => finish();
      const onError = () => finish();
      const timer = setTimeout(() => finish(), durationSec * 1000);
      function cleanup() {
        clearTimeout(timer);
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
        hls.on(window.Hls.Events.ERROR, (_event, data) => { if (data?.fatal) finish(); });
        hls.loadSource(intro.url);
        hls.attachMedia(video);
      } else {
        video.src = intro.url;
        video.load();
        video.play().catch(() => {});
      }
    });
  }
  function attachStream(url, request) {
    if (!video || request !== playerRequest) return;
    destroyVideo();
    playerStatus("Loading secure live stream…");
    const isHls = /\.m3u8(?:$|\?)/i.test(url) || url.includes("/s/");
    if (isHls && window.Hls?.isSupported()) {
      hls = new window.Hls({ enableWorker: true, backBufferLength: 30, manifestLoadingTimeOut: 15000, levelLoadingTimeOut: 15000 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (request !== playerRequest) return;
        playerStatus("Ready — press play if your browser paused autoplay.");
        video.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal || request !== playerRequest) return;
        playerStatus("Stream could not load. The source may be offline or blocking cross-origin playback.", true);
        if ($("playerRetry")) $("playerRetry").hidden = false;
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.load();
      video.play().catch(() => playerStatus("Ready — press play to start."));
    }
  }
  async function fetchChannel(request) {
    try {
      const response = await fetch("/api/embed?action=stream&id=" + encodeURIComponent(currentChannel.id));
      const data = await response.json();
      if (request !== playerRequest) return;
      if (!response.ok || !data.ok) {
        if (response.status === 403) {
          destroyVideo();
          if (video) video.hidden = true;
          if ($("playerPro")) $("playerPro").hidden = false;
          playerStatus("PRO subscription required", true);
          return;
        }
        throw new Error(data.error || "Stream unavailable");
      }
      attachStream(data.url, request);
      track("stream_play", "/channel/" + currentChannel.id);
    } catch (error) {
      if (request !== playerRequest) return;
      playerStatus(error.message || "Stream failed", true);
      if ($("playerRetry")) $("playerRetry").hidden = false;
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
  $("chGrid")?.addEventListener("click", (event) => { const button = event.target.closest("[data-channel]"); if (button) openChannel(button.dataset.channel); });
  $("channelSearch")?.addEventListener("input", () => { visibleChannels = 36; renderChannels(); });
  $("channelCategory")?.addEventListener("change", () => { visibleChannels = 36; renderChannels(); });
  $("chLoadMore")?.addEventListener("click", () => { visibleChannels += 36; renderChannels(); });
  $("guideChannel")?.addEventListener("change", renderGuide);
  $("guideRefresh")?.addEventListener("click", loadGuide);
  $("playerClose")?.addEventListener("click", closePlayer);
  $("playerDialog")?.addEventListener("cancel", (event) => { event.preventDefault(); closePlayer(); });
  $("playerSkip")?.addEventListener("click", () => { if (introFinish) introFinish(); });
  $("playerRetry")?.addEventListener("click", () => { if (currentChannel) openChannel(currentChannel.id, { skipIntro: true }); });
  $("playerTrial")?.addEventListener("click", closePlayer);
  $("playerDialog")?.addEventListener("click", (event) => { if (event.target === $("playerDialog")) closePlayer(); });
  video?.addEventListener("playing", () => {
    if (introActive) playerStatus("✨ Welcome intro playing…");
    else { playerStatus("● Live — playing"); if ($("playerRetry")) $("playerRetry").hidden = true; }
  });
  video?.addEventListener("waiting", () => playerStatus(introActive ? "Intro buffering…" : "Buffering…"));
  video?.addEventListener("error", () => {
    if (introActive || !video || video.hidden) return;
    playerStatus("Playback failed. Check the source or retry.", true);
    if ($("playerRetry")) $("playerRetry").hidden = false;
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
    const requested = new URLSearchParams(location.search).get("channel");
    if (requested) openChannel(requested);
    track("page_view", location.pathname + location.hash);
  })();
})();
