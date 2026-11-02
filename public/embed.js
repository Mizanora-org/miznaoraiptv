/*!
 * Mizanora IPTV — Embeddable Widget (embed.js)
 * ----------------------------------------------
 * Kisi bhi website mein sirf ye 2 lines lagao:
 *
 *   <div id="mizanora-widget"></div>
 *   <script src="https://miznaoraiptv.vercel.app/embed.js"
 *           data-mz-target="#mizanora-widget"
 *           data-mz-widget="plans"          <!-- plans | channels | order | trial -->
 *           data-mz-api="https://miznaoraiptv.vercel.app"
 *           data-mz-theme="dark" defer></script>
 *
 * Widgets: "plans" (pricing cards), "channels" (playable live TV grid),
 * "order" (subscription order form), "trial" (free 1-day PRO trial).
 * API: GET  {api}/api/embed?action=config|channels|movies|series|order-status
 *      POST {api}/api/embed?action=order|trial|reseller/register
 * No jQuery, no build step, CORS-enabled. © Mizanora Projects — Muaaz Iqbal
 */
(function () {
  "use strict";

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="embed.js"]');
    return s[s.length - 1];
  })();
  if (!script) return;

  var API = (script.getAttribute("data-mz-api") || script.src.replace(/\/embed\.js.*$/, "")).replace(/\/+$/, "");
  var TARGET = script.getAttribute("data-mz-target") || "#mizanora-widget";
  var WIDGET = (script.getAttribute("data-mz-widget") || "plans").toLowerCase();
  var THEME = (script.getAttribute("data-mz-theme") || "dark").toLowerCase();
  var ACCENT = script.getAttribute("data-mz-accent") || "#10b981";

  var CSS = [
    ".mzw{--mz-accent:" + ACCENT + ";font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;max-width:980px;margin:16px auto;color:" + (THEME === "light" ? "#0f172a" : "#e2e8f0") + ";}",
    ".mzw *{box-sizing:border-box}",
    ".mzw-card{background:" + (THEME === "light" ? "#ffffff" : "#0b1a14") + ";border:1px solid " + (THEME === "light" ? "#d1fae5" : "#14532d") + ";border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 8px 30px rgba(0,0,0,.25)}",
    ".mzw-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}",
    ".mzw-head img{width:44px;height:44px;border-radius:12px}",
    ".mzw-head h3{margin:0;font-size:18px}",
    ".mzw-head small{opacity:.75}",
    ".mzw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}",
    ".mzw-ch{background:" + (THEME === "light" ? "#f0fdf4" : "#06120d") + ";border:1px solid " + (THEME === "light" ? "#bbf7d0" : "#166534") + ";border-radius:12px;padding:10px;cursor:pointer;text-align:center;transition:.15s}",
    ".mzw-ch:hover{border-color:var(--mz-accent);transform:translateY(-2px)}",
    ".mzw-ch img{width:52px;height:52px;object-fit:contain;border-radius:8px}",
    ".mzw-ch .n{font-size:12px;margin-top:6px;line-height:1.3;min-height:30px}",
    ".mzw-ch .t{font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.5px}",
    ".mzw-plan{background:" + (THEME === "light" ? "#f0fdf4" : "#06120d") + ";border:1px solid " + (THEME === "light" ? "#bbf7d0" : "#166534") + ";border-radius:14px;padding:14px;text-align:center;display:flex;flex-direction:column;gap:6px}",
    ".mzw-plan.hot{border-color:var(--mz-accent);box-shadow:0 0 0 1px var(--mz-accent)}",
    ".mzw-plan h4{margin:0;font-size:15px}",
    ".mzw-plan .price{font-size:22px;font-weight:800;color:var(--mz-accent)}",
    ".mzw-plan .badge{font-size:10px;background:var(--mz-accent);color:#04120c;border-radius:999px;padding:2px 8px;font-weight:700;width:max-content;margin:0 auto}",
    ".mzw-plan small{opacity:.75;font-size:11px}",
    ".mzw-btn{display:inline-block;background:var(--mz-accent);color:#04120c;border:none;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:13px;text-decoration:none;text-align:center}",
    ".mzw-btn.ghost{background:transparent;color:inherit;border:1px solid " + (THEME === "light" ? "#94a3b8" : "#475569") + "}",
    ".mzw-btn:hover{filter:brightness(1.1)}",
    ".mzw input,.mzw select,.mzw textarea{width:100%;padding:10px;border-radius:10px;border:1px solid " + (THEME === "light" ? "#cbd5e1" : "#334155") + ";background:" + (THEME === "light" ? "#fff" : "#04120c") + ";color:inherit;font-size:13px;margin-bottom:8px}",
    ".mzw label{font-size:11px;opacity:.8;display:block;margin-bottom:3px}",
    ".mzw-msg{padding:10px;border-radius:10px;font-size:13px;margin-top:8px;display:none}",
    ".mzw-msg.ok{display:block;background:rgba(16,185,129,.15);border:1px solid var(--mz-accent)}",
    ".mzw-msg.err{display:block;background:rgba(239,68,68,.15);border:1px solid #ef4444}",
    ".mzw video{width:100%;border-radius:12px;background:#000;aspect-ratio:16/9}",
    ".mzw-row{display:flex;gap:8px;flex-wrap:wrap}",
    ".mzw-row>*{flex:1;min-width:140px}",
    ".mzw-foot{font-size:11px;opacity:.65;text-align:center;margin-top:4px}",
    ".mzw a{color:var(--mz-accent)}"
  ].join("\n");

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function api(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }
  function money(n) { return "PKR " + Number(n || 0).toLocaleString("en-PK"); }

  function mount() {
    var target = document.querySelector(TARGET);
    if (!target) {
      target = el("div");
      target.id = "mizanora-widget";
      document.body.appendChild(target);
    }
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    var root = el("div", "mzw");
    target.appendChild(root);
    render(root);
  }

  function header(root, cfg) {
    var h = el("div", "mzw-card");
    h.appendChild(el("div", "mzw-head",
      '<img src="' + esc(cfg.brand.logo) + '" alt="logo" onerror="this.style.display=\'none\'">' +
      "<div><h3>" + esc(cfg.brand.name) + '</h3><small>' + esc(cfg.brand.tagline) + "</small></div>"));
    root.appendChild(h);
    return h;
  }

  function renderPlans(root, cfg) {
    var card = el("div", "mzw-card");
    card.appendChild(el("h3", null, "💳 Plans & Pricing"));
    var grid = el("div", "mzw-grid");
    (cfg.plans || []).forEach(function (p) {
      var d = p.direct;
      var plan = el("div", "mzw-plan" + (p.badge ? " hot" : ""));
      plan.appendChild(el("div", null,
        (p.badge ? '<span class="badge">' + esc(p.badge) + "</span>" : "") +
        "<h4>" + esc(p.name) + "</h4>" +
        '<div class="price">' + (d > 0 ? money(d) : "FREE") + "</div>" +
        "<small>" + esc(p.urdu || p.tagline || "") + "</small>"));
      var wa = "https://wa.me/923062015326?text=" + encodeURIComponent("Salam! Mujhe " + p.name + " plan chahiye (" + (d > 0 ? "PKR " + d : "FREE") + "). Mizanora IPTV.");
      var row = el("div", "mzw-row");
      row.appendChild(el("a", "mzw-btn", "💬 WhatsApp Order")).setAttribute("href", wa);
      row.lastChild.setAttribute("target", "_blank");
      row.lastChild.setAttribute("rel", "noopener");
      plan.appendChild(row);
      grid.appendChild(plan);
    });
    card.appendChild(grid);
    card.appendChild(el("div", "mzw-foot",
      "Reseller rate: " + money(cfg.pricing.resellerPerUserMonthly) + "/user/month • Trial: " + cfg.pricing.trialDays + " day FREE • Support " + esc(cfg.support.phone) +
      ' • <a href="' + esc(cfg.links.panel) + '">Reseller Panel</a>'));
    root.appendChild(card);
  }

  function renderOrder(root, cfg) {
    var card = el("div", "mzw-card");
    card.appendChild(el("h3", null, "🛒 Place Order (JazzCash)"));
    var f = el("form");
    f.appendChild(el("label", null, "Full name"));
    var name = el("input"); name.placeholder = "e.g. Ahmed Khan"; f.appendChild(name);
    f.appendChild(el("label", null, "WhatsApp number"));
    var wa = el("input"); wa.placeholder = "03XXXXXXXXX"; f.appendChild(wa);
    f.appendChild(el("label", null, "Plan"));
    var sel = el("select");
    (cfg.plans || []).forEach(function (p) {
      var o = el("option", null, esc(p.name) + " — " + (p.direct > 0 ? "PKR " + p.direct : "FREE"));
      o.value = p.id; sel.appendChild(o);
    });
    f.appendChild(sel);
    f.appendChild(el("label", null, "JazzCash TID (skip for FREE trial)"));
    var tid = el("input"); tid.placeholder = "Transaction ID"; f.appendChild(tid);
    var msg = el("div", "mzw-msg");
    var btn = el("button", "mzw-btn", "Place Order →");
    btn.type = "submit";
    f.appendChild(btn);
    f.appendChild(msg);
    card.appendChild(f);
    root.appendChild(card);

    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.className = "mzw-msg";
      btn.disabled = true; btn.textContent = "Sending…";
      api("/api/embed?action=order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.value, whatsapp: wa.value, planId: sel.value, txnId: tid.value, audience: "direct", source: "embed-widget" })
      }).then(function (r) {
        btn.disabled = false; btn.textContent = "Place Order →";
        if (r.body && r.body.ok) {
          var o = r.body.order || {};
          msg.className = "mzw-msg ok";
          msg.innerHTML = "✅ <b>Order placed!</b> ID: <b>" + esc(o.id) + "</b> — Amount " + money(o.total) +
            (r.body.payment ? '<br>Send ' + money(r.body.payment.amount) + ' to JazzCash <b>' + esc(r.body.payment.number) + "</b> (" + esc(r.body.payment.title) + ") aur screenshot WhatsApp karein <a href='" + esc(r.body.payment.whatsapp) + "' target='_blank'>" + esc(r.body.payment.whatsapp.replace("https://", "")) + "</a> ref " + esc(o.id) + " ke saath." : "") +
            '<br><a class="mzw-btn" style="margin-top:8px" href="' + esc(cfg.links.site) + '/reseller#order">Track on site</a>';
        } else {
          msg.className = "mzw-msg err";
          msg.textContent = "❌ " + esc((r.body && (r.body.error || r.body.message)) || "Order failed. Try WhatsApp " + cfg.support.phone);
        }
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Place Order →";
        msg.className = "mzw-msg err";
        msg.textContent = "❌ Network error. Check internet and retry.";
      });
    });
  }

  function renderTrial(root, cfg) {
    var card = el("div", "mzw-card");
    card.appendChild(el("h3", null, "🎁 Free " + cfg.pricing.trialDays + "-Day PRO Trial"));
    card.appendChild(el("small", null, "Full PRO access — Xtream + M3U + EPG credentials instantly."));
    var f = el("form");
    f.appendChild(el("label", null, "Email (Gmail)"));
    var em = el("input"); em.type = "email"; em.placeholder = "you@gmail.com"; f.appendChild(em);
    f.appendChild(el("label", null, "WhatsApp (optional)"));
    var wa = el("input"); wa.placeholder = "03XXXXXXXXX"; f.appendChild(wa);
    var msg = el("div", "mzw-msg");
    var btn = el("button", "mzw-btn", "Claim FREE Trial →");
    btn.type = "submit";
    f.appendChild(btn); f.appendChild(msg);
    card.appendChild(f);
    root.appendChild(card);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.className = "mzw-msg";
      btn.disabled = true; btn.textContent = "Claiming…";
      api("/api/embed?action=trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em.value, whatsapp: wa.value, source: "embed-widget" })
      }).then(function (r) {
        btn.disabled = false; btn.textContent = "Claim FREE Trial →";
        var b = r.body || {};
        if (b.ok && b.credentials) {
          var c = b.credentials;
          msg.className = "mzw-msg ok";
          msg.innerHTML = "✅ <b>Trial ACTIVE!</b><br>Server: <code>" + esc(c.serverUrl) + "</code> :" + c.port +
            "<br>User: <code>" + esc(c.username) + "</code> Pass: <code>" + esc(c.password) + "</code>" +
            '<br><a href="' + esc(c.m3u) + '">📥 M3U Playlist</a> • <a href="' + esc(c.epg) + '">📺 EPG</a>' +
            "<br>Player: <a href='" + esc(b.player) + "' target='_blank'>" + esc(cfg.player.name) + "</a>";
        } else {
          msg.className = "mzw-msg err";
          msg.textContent = "❌ " + esc(b.error || "Trial unavailable. WhatsApp " + cfg.support.phone);
        }
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Claim FREE Trial →";
        msg.className = "mzw-msg err";
        msg.textContent = "❌ Network error. Retry.";
      });
    });
  }

  var hlsLoading = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoading) return hlsLoading;
    hlsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = API + "/assets/vendor/hls.min.js";
      s.onload = function () { resolve(window.Hls); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return hlsLoading;
  }

  function renderChannels(root, cfg) {
    var card = el("div", "mzw-card");
    card.appendChild(el("h3", null, "📺 Live TV (" + esc(cfg.brand.name) + ")"));
    var playerWrap = el("div", null);
    playerWrap.style.display = "none";
    var video = el("video");
    video.controls = true; video.playsInline = true;
    playerWrap.appendChild(video);
    var pname = el("div", null, "");
    pname.style.cssText = "font-size:12px;margin-top:6px;opacity:.85";
    playerWrap.appendChild(pname);
    card.appendChild(playerWrap);
    var grid = el("div", "mzw-grid");
    card.appendChild(grid);
    root.appendChild(card);
    card.appendChild(el("div", "mzw-foot", 'Powered by <a href="' + esc(cfg.links.site) + '" target="_blank">' + esc(cfg.brand.name) + "</a> — Xtream • M3U • MAG/Stalker"));

    api("/api/embed?action=channels&limit=120").then(function (r) {
      var list = (r.body && r.body.channels) || [];
      if (!list.length) { grid.appendChild(el("small", null, "No channels yet.")); return; }
      list.forEach(function (ch) {
        var b = el("div", "mzw-ch");
        b.appendChild(el("img")).setAttribute("src", ch.logo);
        b.lastChild.setAttribute("alt", "");
        b.lastChild.setAttribute("onerror", "this.style.visibility='hidden'");
        b.appendChild(el("div", "t", esc(ch.tier === "pro" ? "PRO" : "FREE") + (ch.hd ? " • HD" + (ch.hd === 4 ? " 4K" : "") : "")));
        b.appendChild(el("div", "n", esc(ch.name)));
        b.addEventListener("click", function () { play(ch); });
        grid.appendChild(b);
      });
    });

    function play(ch) {
      playerWrap.style.display = "block";
      pname.textContent = "▶ " + ch.name;
      var url = ch.playUrl;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url; // Safari native HLS
        video.play().catch(function () {});
        return;
      }
      loadHls().then(function (Hls) {
        if (Hls && Hls.isSupported()) {
          if (play._hls) play._hls.destroy();
          var hls = new Hls({ maxBufferLength: 30 });
          play._hls = hls;
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () {}); });
        } else {
          window.open(url, "_blank");
        }
      }).catch(function () { window.open(url, "_blank"); });
    }
  }

  function render(root) {
    root.appendChild(el("div", "mzw-card", "<small>Loading " + esc(WIDGET) + "…</small>"));
    api("/api/embed?action=config").then(function (r) {
      var cfg = (r.body && r.body.ok) ? r.body : null;
      root.innerHTML = "";
      if (!cfg) {
        root.appendChild(el("div", "mzw-card", "⚠️ Mizanora IPTV API reach nahi hui. <a href='" + API + "'>" + esc(API) + "</a> check karein."));
        return;
      }
      header(root, cfg);
      var widgets = WIDGET.split(",").map(function (w) { return w.trim(); });
      widgets.forEach(function (w) {
        if (w === "plans" || w === "all") renderPlans(root, cfg);
        if (w === "channels" || w === "all") renderChannels(root, cfg);
        if (w === "order") renderOrder(root, cfg);
        if (w === "trial") renderTrial(root, cfg);
      });
    }).catch(function () {
      root.innerHTML = "";
      root.appendChild(el("div", "mzw-card", "⚠️ Network error while loading Mizanora IPTV widget."));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
