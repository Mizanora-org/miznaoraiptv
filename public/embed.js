/* Mizanora IPTV embeddable channel grid — click a channel to open its player. */
(function () {
  "use strict";
  var script = document.currentScript || (function () { var all = document.querySelectorAll('script[src*="embed.js"]'); return all[all.length - 1]; })();
  var host = script && script.src ? script.src.replace(/\/embed\.js.*$/, "") : location.origin;
  var theme = script && script.getAttribute("data-theme") || "dark";
  var limit = Math.max(1, Math.min(100, Number(script && script.getAttribute("data-limit")) || 36));
  var category = String(script && script.getAttribute("data-category") || "").trim().toLowerCase();
  var mount = document.createElement("div");
  mount.setAttribute("data-mizanora-embed", "");
  mount.style.cssText = "font-family:system-ui,Segoe UI,sans-serif;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
  if (script && script.parentNode) script.parentNode.insertBefore(mount, script);
  else document.body.appendChild(mount);
  function message(text, color) {
    mount.textContent = "";
    var item = document.createElement("div");
    item.style.cssText = "grid-column:1/-1;text-align:center;padding:18px;color:" + (color || "#9fe8c8");
    item.textContent = text;
    mount.appendChild(item);
  }
  message("📺 Mizanora IPTV channels load ho rahe hain…");
  fetch(host + "/api/embed?action=channels").then(function (response) {
    return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "Embed failed"); return data; });
  }).then(function (data) {
    if (!data.ok || !Array.isArray(data.channels) || !data.channels.length) return message("📺 Mizanora IPTV — channels abhi available nahi.");
    var channels = data.channels.filter(function (channel) { return !category || String(channel.category || channel.group || "").toLowerCase() === category; });
    if (!channels.length) return message("📺 Is category mein channels available nahi.");
    mount.textContent = "";
    channels.slice(0, limit).forEach(function (channel) {
      var card = document.createElement("a");
      card.href = host + "/?channel=" + encodeURIComponent(channel.id) + "#channels";
      card.target = "_blank";
      card.rel = "noopener";
      card.setAttribute("aria-label", "Play " + channel.name);
      card.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;text-decoration:none;" + (theme === "dark" ? "background:#0a1f16;color:#eafff5;border:1px solid #14532d" : "background:#fff;color:#052e16;border:1px solid #bbf7d0");
      if (channel.logo) {
        var image = document.createElement("img");
        image.src = channel.logo; image.alt = ""; image.loading = "lazy";
        image.style.cssText = "width:34px;height:34px;border-radius:8px;object-fit:cover";
        image.onerror = function () { image.remove(); };
        card.appendChild(image);
      }
      var name = document.createElement("span");
      name.style.cssText = "font-weight:600;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      name.textContent = channel.name;
      card.appendChild(name);
      var access = document.createElement("span");
      access.style.cssText = "margin-left:auto;font-size:.65rem;opacity:.78;white-space:nowrap";
      access.textContent = channel.tier === "pro" ? "PRO" : "▶ FREE";
      card.appendChild(access);
      mount.appendChild(card);
    });
    var foot = document.createElement("a");
    foot.href = host; foot.target = "_blank"; foot.rel = "noopener";
    foot.style.cssText = "grid-column:1/-1;text-align:center;font-size:.72rem;opacity:.7;padding-top:6px;color:inherit;text-decoration:none";
    foot.textContent = "Powered by Mizanora IPTV";
    mount.appendChild(foot);
  }).catch(function () { message("⚠️ Mizanora IPTV embed load nahi ho saka.", "#fca5a5"); });
})();
