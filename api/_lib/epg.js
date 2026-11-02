/** Common XMLTV parsing/formatting without executing untrusted XML. */
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value) => String(value ?? "").replace(/[\0\r\n]+/g, " ").trim();

export function decodeXml(value) {
  return clean(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const radix = lower.startsWith("#x") ? 16 : 10;
    const number = Number.parseInt(lower.replace(/^#x?/, ""), radix);
    return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

export function xmlAttributes(value) {
  const attrs = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(String(value || "")))) attrs[match[1]] = decodeXml(match[2] ?? match[3]);
  return attrs;
}

function tag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, " ")) : "";
}

function tagAttr(block, name, attribute) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(`<${escaped}\\s+([^>]*?)\\/?\\s*>`, "i"));
  return match ? xmlAttributes(match[1])[attribute] || "" : "";
}

export function parseXmlTvDate(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?\s*(Z|[+-]\d{4})?/);
  if (!match) return 0;
  const [, year, month, day, hour = "00", minute = "00", second = "00", zone = "Z"] = match;
  const suffix = zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${suffix}`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatXmlTvDate(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().replace(/[-:]/g, "").replace("T", "").replace(/\.\d{3}Z$/, " +0000");
}

export function parseXmlTv(input, { maxProgrammes = 30000 } = {}) {
  if (typeof input !== "string" || !input.trim()) throw fail("XMLTV content is empty.");
  if (input.length > 8_000_000) throw fail("XMLTV upload exceeds the 8 MB limit.", 413);
  if (!/<tv(?:\s|>)/i.test(input)) throw fail("This is not an XMLTV document (<tv> root is missing).");
  const channels = [];
  const programmes = [];
  const errors = [];
  let skipped = 0;
  const channelPattern = /<channel\s+([^>]*)>([\s\S]*?)<\/channel>/gi;
  let match;
  while ((match = channelPattern.exec(input))) {
    const attrs = xmlAttributes(match[1]);
    const id = clean(attrs.id);
    if (!id) continue;
    const body = match[2];
    channels.push({
      id: id.slice(0, 180),
      name: (tag(body, "display-name") || id).slice(0, 180),
      icon: tagAttr(body, "icon", "src").slice(0, 1000),
      url: tag(body, "url").slice(0, 1000)
    });
  }
  const programmePattern = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  while ((match = programmePattern.exec(input))) {
    const attrs = xmlAttributes(match[1]);
    const start = parseXmlTvDate(attrs.start);
    const stop = parseXmlTvDate(attrs.stop);
    const channelId = clean(attrs.channel);
    if (!channelId || !start || !stop || stop <= start) {
      skipped++;
      if (errors.length < 40) errors.push("Skipped programme with invalid channel/start/stop.");
      continue;
    }
    const body = match[2];
    programmes.push({
      id: `${channelId}-${start}`,
      channelId: channelId.slice(0, 180),
      start, stop,
      title: (tag(body, "title") || "Untitled programme").slice(0, 240),
      subTitle: tag(body, "sub-title").slice(0, 240),
      description: tag(body, "desc").slice(0, 3000),
      category: tag(body, "category").slice(0, 120),
      icon: tagAttr(body, "icon", "src").slice(0, 1000),
      episode: tag(body, "episode-num").slice(0, 120),
      date: tag(body, "date").slice(0, 30),
      rating: tag(body, "rating > value") || (body.match(/<rating\b[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/i)?.[1] ? decodeXml(body.match(/<rating\b[^>]*>[\s\S]*?<value[^>]*>([\s\S]*?)<\/value>/i)[1]) : ""),
      isNew: /<new\s*\/>/i.test(body),
      isPremiere: /<premiere(?:\s|\/>|>)/i.test(body)
    });
    if (programmes.length > maxProgrammes) throw fail(`XMLTV contains more than ${maxProgrammes} programmes.`, 413);
  }
  if (!programmes.length && !channels.length) throw fail("No XMLTV channels or programmes found.");
  return { channels, programmes, skipped, errors };
}

export function programmeXml(programme, escapeXml) {
  const esc = typeof escapeXml === "function" ? escapeXml : (value) => String(value ?? "");
  const p = programme;
  let out = `<programme start="${esc(formatXmlTvDate(p.start))}" stop="${esc(formatXmlTvDate(p.stop))}" channel="${esc(p.channelId)}">`;
  out += `<title>${esc(p.title || "Untitled programme")}</title>`;
  if (p.subTitle) out += `<sub-title>${esc(p.subTitle)}</sub-title>`;
  if (p.description) out += `<desc>${esc(p.description)}</desc>`;
  if (p.category) out += `<category>${esc(p.category)}</category>`;
  if (p.episode) out += `<episode-num>${esc(p.episode)}</episode-num>`;
  if (p.date) out += `<date>${esc(p.date)}</date>`;
  if (p.icon) out += `<icon src="${esc(p.icon)}"/>`;
  if (p.rating) out += `<rating><value>${esc(p.rating)}</value></rating>`;
  if (p.isNew) out += "<new/>";
  if (p.isPremiere) out += "<premiere/>";
  return out + "</programme>\n";
}
