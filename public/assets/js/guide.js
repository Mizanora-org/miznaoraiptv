/* Dynamic, copyable Mizanora integration examples. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const origin = location.origin;
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  function toast(message) {
    const item = $("toast");
    if (!item) return;
    item.textContent = message; item.className = "toast show";
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { item.className = "toast"; }, 2500);
  }
  function renderEmbed() {
    const theme = $("embedTheme")?.value || "dark";
    const limit = Math.max(1, Math.min(100, Number($("embedLimit")?.value) || 12));
    const category = $("embedCategory")?.value.trim() || "";
    set("embedCode", `<script src="${origin}/embed.js" data-theme="${theme}" data-limit="${limit}"${category ? ` data-category="${category.replace(/"/g, "")}"` : ""}><\/script>`);
  }
  set("apiBase", origin + "/api");
  set("publicExample", `const response = await fetch("${origin}/api/embed?action=guide&limit=20");\nconst data = await response.json();\nif (!response.ok || !data.ok) throw new Error(data.error || "Guide failed");\nfor (const entry of data.guide) {\n  console.log(entry.channel.name, entry.now?.title || "No current programme", entry.next?.title || "");\n}`);
  set("xtreamExample", `Xtream server: ${origin}\nUsername: YOUR_CLIENT_USERNAME\nPassword: YOUR_CLIENT_PASSWORD\n\nM3U:\n${origin}/get.php?username=YOUR_CLIENT_USERNAME&password=YOUR_CLIENT_PASSWORD&type=m3u_plus&output=m3u8\n\nXMLTV EPG:\n${origin}/xmltv.php?username=YOUR_CLIENT_USERNAME&password=YOUR_CLIENT_PASSWORD\n\nMAG/Stalker portal:\n${origin}/portal.php`);
  set("resellerExample", [
    "// Node.js 20+ backend — set MZ_RESELLER_KEY in server environment variables.",
    "const response = await fetch(\"" + origin + "/api/panel?action=reseller/clients\", {",
    "  method: \"POST\",",
    "  headers: {",
    "    \"Content-Type\": \"application/json\",",
    "    \"x-api-key\": process.env.MZ_RESELLER_KEY",
    "  },",
    "  body: JSON.stringify({ action: \"reseller/clients\" })",
    "});",
    "const data = await response.json();",
    "if (!response.ok || !data.ok) throw new Error(data.error || \"Request failed\");",
    "console.log(data.clients);"
  ].join("\n"));
  ["embedTheme", "embedLimit", "embedCategory"].forEach((id) => $(id)?.addEventListener("input", renderEmbed));
  renderEmbed();
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      const area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select();
      const result = document.execCommand?.("copy"); area.remove(); return !!result;
    } catch { return false; }
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const target = $(button.dataset.copy);
    toast(await copy(target?.textContent || "") ? "Code copied" : "Clipboard unavailable — select the code manually");
  });
})();
