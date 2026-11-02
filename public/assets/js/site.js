/* Mizanora IPTV — landing page logic (fresh rebuild) */
(function () {
  const $ = (id) => document.getElementById(id);
  const toast = (m, err) => {
    const t = $("toast");
    if (!t) return;
    t.textContent = m;
    t.className = "toast show" + (err ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = "toast"), 4200);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // live channel preview from embed API
  fetch("/api/embed?action=channels")
    .then((r) => r.json())
    .then((d) => {
      const grid = $("chGrid");
      if (!grid) return;
      if (!d || !d.ok || !d.channels || !d.channels.length) { grid.innerHTML = '<div class="ch"><span>Channels list load nahi hui — baad mein try karein.</span></div>'; return; }
      $("stChannels").textContent = "+" + d.count;
      grid.innerHTML = "";
      d.channels.slice(0, 24).forEach((c) => {
        const el = document.createElement("div");
        el.className = "ch";
        el.style.position = "relative";
        el.innerHTML = (c.logo ? `<img src="${esc(c.logo)}" alt="">` : "📺") + `<span>${esc(c.name)}</span><em>${esc(c.group || "")}</em>` +
          (c.previewVideo ? `<video muted loop playsinline preload="none" src="${esc(c.previewVideo)}" style="display:none;position:absolute;bottom:110%;left:0;width:230px;border-radius:10px;border:1px solid var(--gold);z-index:9;box-shadow:var(--shadow)"></video>` : "");
        if (c.previewVideo) {
          el.addEventListener("mouseenter", () => { const v = el.querySelector("video"); if (v) { v.style.display = "block"; v.play().catch(() => {}); } });
          el.addEventListener("mouseleave", () => { const v = el.querySelector("video"); if (v) { v.pause(); v.style.display = "none"; } });
        }
        grid.appendChild(el);
      });
    })
    .catch(() => {});

  // trial form
  $("trialForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("trialEmail").value.trim();
    try {
      const r = await fetch("/api/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trial", email, whatsapp: $("trialWa").value.trim(), deviceId: "web-" + (localStorage.getItem("mz_dev") || (localStorage.setItem("mz_dev", Math.random().toString(36).slice(2)), localStorage.getItem("mz_dev"))) })
      });
      const d = await r.json();
      if (!d.ok) return toast(d.error || "Trial claim failed", true);
      toast("🎁 Trial active! Credentials neeche hain.");
      const c = d.client;
      $("credOut").innerHTML = `<div class="card" style="border-color:var(--gold)"><h3>🔑 Aapke FREE Xtream Codes</h3>
        <p><b>Server:</b> ${location.origin} &nbsp; <b>Username:</b> <code>${esc(c.username)}</code> &nbsp; <b>Password:</b> <code>${esc(c.password)}</code></p>
        <p style="word-break:break-all"><b>M3U:</b> ${esc(d.links.m3u)}<br><b>EPG:</b> ${esc(d.links.epg)}<br><b>player_api:</b> ${esc(d.links.playerApi)}</p>
        <p>Expire: ${new Date(c.expDate * 1000).toLocaleString()}. Kisi bhi IPTV app mein daal kar dekhein — Siravex player recommended.</p></div>`;
    } catch (err) { toast("Network error: " + err.message, true); }
  });

  // order form
  $("orderForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "order",
          name: $("ordName").value.trim(), email: $("ordEmail").value.trim(),
          whatsapp: $("ordWa").value.trim(), planId: $("ordPlan").value, via: "whatsapp"
        })
      });
      const d = await r.json();
      if (!d.ok) return toast(d.error || "Order failed", true);
      toast("🧾 Order " + d.order.id + " receive ho gaya!");
      $("credOut").innerHTML = `<div class="card"><h3>🧾 Order ${esc(d.order.id)}</h3><p>${esc(d.message)}</p>
        <p><a class="btn btn-gold btn-sm" href="${esc(d.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp par pay karein</a></p></div>`;
    } catch (err) { toast("Network error: " + err.message, true); }
  });
})();
