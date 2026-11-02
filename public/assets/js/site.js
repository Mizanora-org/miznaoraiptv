/* Mizanora IPTV — public catalog, working HLS preview, trials and orders. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
      if (!id) { id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now()); sessionStorage.setItem("mz_session", id); }
      return id;
    } catch { return "web-session"; }
  }
  function track(event, route) {
    const payload = JSON.stringify({ action: "track", event, route: route || location.pathname, sessionId: sessionId() });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/panel", new Blob([payload], { type: "application/json" }));
      else fetch("/api/panel", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    } catch { /* Analytics must never break playback. */ }
  }

  /* ---------- real channel player ---------- */
  let hls = null;
  let currentChannel = null;
  let playerRequest = 0;
  let channels = [];
  const video = $("liveVideo");
  function playerStatus(message, error = false) {
    const status = $("playerStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("err", error);
  }
  function closePlayer() {
    playerRequest++;
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    const dialog = $("playerDialog");
    if (dialog?.hasAttribute("open")) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }
  function attachStream(url) {
    if (!video) return;
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    playerStatus("Loading stream…");
    const isHls = /\.m3u8(?:$|\?)/i.test(url) || url.includes("/s/");
    if (isHls && window.Hls?.isSupported()) {
      hls = new window.Hls({ enableWorker: true, backBufferLength: 30, manifestLoadingTimeOut: 15000, levelLoadingTimeOut: 15000 });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        playerStatus("Ready — press play if your browser paused autoplay.");
        video.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
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
  async function openChannel(id) {
    const channel = channels.find((c) => String(c.id) === String(id) || String(c.streamId) === String(id));
    if (!channel) return;
    const request = ++playerRequest;
    currentChannel = channel;
    const dialog = $("playerDialog");
    setText("playerTitle", channel.name);
    setText("playerGroup", channel.group || channel.category || "Live TV");
    if ($("playerPro")) $("playerPro").hidden = true;
    if ($("playerRetry")) $("playerRetry").hidden = true;
    if (video) video.hidden = false;
    playerStatus("Requesting a secure stream…");
    if (dialog && !dialog.hasAttribute("open")) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    try {
      const response = await fetch("/api/embed?action=stream&id=" + encodeURIComponent(channel.id));
      const data = await response.json();
      if (request !== playerRequest) return;
      if (!response.ok || !data.ok) {
        if (response.status === 403) {
          if (video) video.hidden = true;
          if ($("playerPro")) $("playerPro").hidden = false;
          playerStatus("PRO subscription required", true);
          return;
        }
        throw new Error(data.error || "Stream unavailable");
      }
      attachStream(data.url);
      track("stream_play", "/channel/" + channel.id);
    } catch (error) {
      if (request !== playerRequest) return;
      playerStatus(error.message || "Stream failed", true);
      if ($("playerRetry")) $("playerRetry").hidden = false;
    }
  }
  function setText(id, value) { const el = $(id); if (el) el.textContent = String(value ?? ""); }
  $("playerClose")?.addEventListener("click", closePlayer);
  $("playerRetry")?.addEventListener("click", () => { if (currentChannel) openChannel(currentChannel.id); });
  $("playerTrial")?.addEventListener("click", closePlayer);
  $("playerDialog")?.addEventListener("click", (event) => { if (event.target === $("playerDialog")) closePlayer(); });
  video?.addEventListener("playing", () => { playerStatus("● Live — playing"); if ($("playerRetry")) $("playerRetry").hidden = true; });
  video?.addEventListener("waiting", () => playerStatus("Buffering…"));
  video?.addEventListener("error", () => {
    if (!video.hidden) {
      playerStatus("Playback failed. Check the source or retry.", true);
      if ($("playerRetry")) $("playerRetry").hidden = false;
    }
  });

  async function loadChannels() {
    const grid = $("chGrid");
    try {
      const response = await fetch("/api/embed?action=channels");
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.channels)) throw new Error(data.error || "Channels list load nahi hui");
      channels = data.channels;
      setText("stChannels", data.count);
      if (!grid) return;
      if (!channels.length) { grid.innerHTML = '<div class="ch"><span>No channels configured yet.</span></div>'; return; }
      grid.innerHTML = channels.slice(0, 36).map((c) => `<button class="ch" type="button" data-channel="${esc(c.id)}" aria-label="Play ${esc(c.name)}">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy">` : '<span aria-hidden="true">📺</span>'}<span>${esc(c.name)}</span><em class="access ${c.tier === "pro" ? "pro" : ""}">${c.tier === "pro" ? "PRO" : "▶ FREE"}</em></button>`).join("");
      const requested = new URLSearchParams(location.search).get("channel");
      if (requested) openChannel(requested);
    } catch (error) {
      if (grid) grid.innerHTML = `<div class="ch"><span>${esc(error.message)} — refresh karke dobara try karein.</span></div>`;
      setText("stChannels", "—");
    }
  }
  $("chGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-channel]");
    if (button) openChannel(button.dataset.channel);
  });

  /* ---------- forms ---------- */
  function deviceId() {
    try {
      let id = localStorage.getItem("mz_dev");
      if (!id) { id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); localStorage.setItem("mz_dev", id); }
      return id;
    } catch { return "web-" + Math.random().toString(36).slice(2); }
  }
  async function postJson(action, payload) {
    const response = await fetch("/api/panel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function busy(form, value) {
    const button = form?.querySelector('button[type="submit"]');
    if (button) { button.disabled = value; button.dataset.original ||= button.textContent; button.textContent = value ? "Please wait…" : button.dataset.original; }
  }
  $("trialForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form, true);
    try {
      const data = await postJson("trial", { email: $("trialEmail").value.trim(), whatsapp: $("trialWa").value.trim(), deviceId: "web-" + deviceId() });
      const c = data.client;
      $("credOut").innerHTML = `<div class="card" style="border-color:var(--gold)"><h3>🔑 Aapke FREE Xtream Codes</h3><p><b>Server:</b> ${esc(location.origin)}<br><b>Username:</b> <code>${esc(c.username)}</code><br><b>Password:</b> <code>${esc(c.password)}</code></p><p style="word-break:break-all"><b>M3U:</b> ${esc(data.links.m3u)}<br><b>EPG:</b> ${esc(data.links.epg)}</p><p>Expire: ${new Date(Number(c.expDate) * 1000).toLocaleString()}. Credentials kisi bhi compatible IPTV app mein use karein.</p></div>`;
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
      const data = await postJson("order", {
        name: $("ordName").value.trim(), email: $("ordEmail").value.trim(),
        whatsapp: $("ordWa").value.trim(), planId: $("ordPlan").value, via: "whatsapp"
      });
      $("credOut").innerHTML = `<div class="card"><h3>🧾 Order ${esc(data.order.id)}</h3><p>${esc(data.message)}</p><p><b>Amount:</b> Rs ${Number(data.order.amount || 0)}</p><p><a class="btn btn-gold btn-sm" href="${esc(data.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp par pay karein</a></p></div>`;
      toast("🧾 Order " + data.order.id + " receive ho gaya!");
      track("order_created", "/order/" + data.order.id);
    } catch (error) { toast(error.message, true); }
    finally { busy(form, false); }
  });

  loadChannels();
  track("page_view", location.pathname + location.hash);
})();
