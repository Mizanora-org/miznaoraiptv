/* Mizanora IPTV — embeddable channel widget (CORS-free, any website)
 * Usage: <script src="https://YOUR/embed.js" data-mizanora-embed data-theme="dark"></script>
 * Renders a live channel grid from /api/embed?action=channels */
(function () {
  "use strict";
  var script = document.currentScript || (function(){var s=document.querySelectorAll('script[src$="embed.js"]');return s[s.length-1];})();
  var host = (script && script.src) ? script.src.replace(/\/embed\.js.*$/, "") : location.origin;
  var theme = (script && script.getAttribute("data-theme")) || "dark";
  var mount = document.createElement("div");
  mount.setAttribute("data-mizanora-embed", "");
  mount.style.cssText = "font-family:system-ui,Segoe UI,sans-serif;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
  if (script && script.parentNode) script.parentNode.insertBefore(mount, script);
  else document.body.appendChild(mount);
  mount.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:18px;color:#9fe8c8">📺 Mizanora IPTV channels load ho rahe hain…</div>';
  fetch(host + "/api/embed?action=channels")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok || !d.channels || !d.channels.length) {
        mount.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:18px;color:#9fe8c8">📺 Mizanora IPTV — channels abhi load nahi hue.</div>';
        return;
      }
      mount.innerHTML = "";
      d.channels.slice(0, 24).forEach(function (c) {
        var card = document.createElement("a");
        card.href = host + "/player_api.php";
        card.target = "_blank";
        card.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;text-decoration:none;" +
          (theme === "dark" ? "background:#0a1f16;color:#eafff5;border:1px solid #14532d" : "background:#fff;color:#052e16;border:1px solid #bbf7d0");
        card.innerHTML = (c.logo ? '<img src="' + c.logo + '" style="width:34px;height:34px;border-radius:8px;object-fit:cover">' : '<span style="font-size:22px">📺</span>') +
          '<span style="font-weight:600;font-size:0.9rem">' + String(c.name).replace(/</g, "&lt;") + "</span>" +
          '<span style="margin-left:auto;font-size:0.7rem;opacity:.7">' + String(c.group || "").replace(/</g, "&lt;") + "</span>";
        mount.appendChild(card);
      });
      var foot = document.createElement("div");
      foot.style.cssText = "grid-column:1/-1;text-align:center;font-size:0.72rem;opacity:.7;padding-top:6px";
      foot.textContent = "Powered by Mizanora IPTV";
      mount.appendChild(foot);
    })
    .catch(function () {
      mount.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:18px;color:#fca5a5">⚠️ Mizanora IPTV embed load nahi ho saka.</div>';
    });
})();
