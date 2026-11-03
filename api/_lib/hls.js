/** Vercel-native HLS playout: short HTTP manifest requests, CDN media segments.
 * No running encoder. Stable per-session sequence numbers use RTDB CAS updates.
 * Supported stitching: muxed MPEG-TS HLS (clear or AES-128). Unsupported
 * sources pass through unchanged instead of being falsely marked offline.
 */
import crypto from 'node:crypto';
import { fetchRemoteText } from './remote.js';
import { rtdbGet, rtdbTransaction, pruneHlsSessions } from './rtdb.js';
import { signPayload, serverSecret } from './util.js';
const SECRET = serverSecret('MZ_STREAM_SECRET', 'mizanora-iptv-stream-v3');
export const PLAYOUT_TTL = 7 * 86400;
const compatibility = message => Object.assign(new Error(message), { status: 422, compatibility: true });
const problem = message => Object.assign(new Error(message), { status: 422 });
const absolute = (value, base) => {
  const url = new URL(value, base);
  if (!/^https?:$/.test(url.protocol) || /[\r\n"]/.test(url.href)) throw problem('Unsafe HLS URL');
  return url.href;
};
const attrs = line => Object.fromEntries([...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
export function parseHls(text, base) {
  if (!String(text).trimStart().startsWith('#EXTM3U')) throw compatibility('Not an HLS playlist');
  const lines = text.trim().split(/\r?\n/).map(l => l.trim());
  const variants = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
    const a = attrs(lines[i]);
    if (!a.AUDIO && (!a.CODECS || /avc1/i.test(a.CODECS)) && lines[i+1] && !lines[i+1].startsWith('#')) variants.push({ url: absolute(lines[i+1], base), bandwidth: Number(a.BANDWIDTH) || 0 });
  }
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF:'))) {
    if (!variants.length) throw compatibility('No muxed AVC variant; separate audio/unsupported codec needs direct mode');
    return { variants: variants.sort((a,b) => a.bandwidth - b.bandwidth) };
  }
  if (lines.some(l => /^#EXT-X-(MAP|BYTERANGE|I-FRAMES-ONLY|PART|SKIP):?/.test(l))) throw compatibility('fMP4, byte-range and low-latency playlists require direct mode');
  const seqLine = lines.find(l => l.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  let sequence = Number(seqLine?.split(':')[1] || 0), duration = 0, key = null, discontinuity = false;
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw problem('Invalid HLS sequence');
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:')) {
      const a = attrs(line);
      if (a.METHOD === 'NONE') key = null;
      else if (a.METHOD === 'AES-128' && (!a.KEYFORMAT || a.KEYFORMAT === 'identity') && a.URI) {
        if (a.IV && !/^0x[0-9a-f]{32}$/i.test(a.IV)) throw problem('Invalid encryption IV');
        key = { url: absolute(a.URI, base), iv: a.IV || '' };
      } else throw compatibility('Unsupported HLS encryption');
    } else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line && !line.startsWith('#')) {
      if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw compatibility('Invalid or excessive HLS segment duration');
      segments.push({ url: absolute(line, base), duration, seq: sequence, discontinuity,
        key: key ? { ...key, iv: key.iv || `0x${BigInt(sequence).toString(16).padStart(32, '0')}` } : null });
      sequence++; duration = 0; discontinuity = false;
    }
  }
  if (!segments.length || segments.length > 5000) throw problem('Empty or oversized media playlist');
  const declared = Number(lines.find(l => l.startsWith('#EXT-X-TARGETDURATION:'))?.split(':')[1]);
  const observed = Math.max(2, ...segments.map(segment => Math.round(segment.duration)));
  if (declared && (!Number.isInteger(declared) || declared > 60 || declared < observed)) throw compatibility('Invalid declared HLS target duration');
  return { segments, ended: lines.includes('#EXT-X-ENDLIST'), target: Math.max(2, declared || observed) };
}
async function discoverHls(url) {
  const deadline = Date.now() + 8000;
  const seen = new Set();
  for (let depth = 0; depth < 3; depth++) {
    if (seen.has(url)) throw problem('Recursive HLS master');
    seen.add(url);
    const fetched = await fetchRemoteText(url, { maxBytes: 512_000, timeoutMs: Math.max(1, Math.min(6000, deadline - Date.now())) });
    const parsed = parseHls(fetched.text, fetched.url);
    if (!parsed.variants) return { ...parsed, mediaUrl: fetched.url };
    url = parsed.variants[0].url;
  }
  throw problem('Nested HLS master limit exceeded');
}
// Per-instance bounded coalescing, not a correctness dependency. Signed source
// URLs are exact cache keys; a cold Vercel instance simply fetches again.
const sourceCache = new Map();
export function clearHlsCache() { sourceCache.clear(); }
export async function loadHls(url) {
  const cached = sourceCache.get(url);
  if (cached && Date.now() < cached.until) return cached.promise;
  if (sourceCache.size >= 64) sourceCache.delete(sourceCache.keys().next().value);
  const entry = { until: Date.now() + 1500 };
  entry.promise = discoverHls(url).catch(error => { if (sourceCache.get(url) === entry) sourceCache.delete(url); throw error; });
  sourceCache.set(url, entry);
  return entry.promise;
}
function useDirect(error) {
  // Provider access/rate restrictions on a server-side fetch are not proof
  // that the viewer's device cannot play the original URL.
  return error?.compatibility || [401, 403, 429].includes(error?.upstreamStatus);
}
export function cardSegments(base, kind) {
  const folder = { intro: 'welcome', offline: 'channel-offline', recharge: 'pro-unlock', comingSoon: 'coming-soon' }[kind];
  if (!folder) throw problem('Unknown broadcast card');
  return Array.from({ length: 4 }, (_, i) => ({ url: `${base}/media/${folder}/seg${i}.ts`, duration: 2, seq: i, key: null, discontinuity: i === 0 }));
}
function add(state, segment, mode) {
  if (['offline', 'recharge'].includes(mode) && ['live', 'vodLive'].includes(state.mode)) state.segments = [];
  const disc = state.next > 0 && (state.mode !== mode || segment.discontinuity);
  if (disc) state.discontinuities++;
  state.segments.push({ ...segment, n: state.next++, disc, ds: state.discontinuities, mode });
  state.mode = mode;
  // Keep a bounded media window; segment numbers and discontinuity sequence do
  // not reset when switching from source -> offline -> source -> recharge.
  let duration = state.segments.reduce((sum, item) => sum + item.duration, 0);
  while (state.segments.length > 18 && duration - state.segments[0].duration >= state.target * 3) duration -= state.segments.shift().duration;
  while (state.segments.length > 90) state.segments.shift();
}
export function advanceHls(previous, { now, source = null, fallback = '', base, error = '' }) {
  const s = structuredClone(previous);
  s.segments ||= [];
  // Publish enough playable media up front. Delaying each intro segment by
  // wall-clock time starved standard clients polling once per target duration.
  if (s.intro && s.next === 0) for (const segment of cardSegments(base, 'intro')) add(s, segment, 'intro');
  if (!source && !fallback && !error && s.mode === 'intro') return s;
  if (!fallback && !source && s.mode === 'live') {
    s.failureSince ||= now;
    s.error = error;
    if (now - s.failureSince < Math.max(15000, s.target * 3000)) return s;
  } else if (source || fallback) s.failureSince = 0;
  let mode = fallback;
  if (!mode && !source) mode = 'offline';
  if (!mode && !source.ended) {
    const latest = source.segments.at(-1);
    const identity = `${latest.seq}:${latest.url}`;
    if (s.cursorSeq == null || latest.seq !== s.cursorSeq) {
      const reset = s.cursorSeq != null && latest.seq < s.cursorSeq;
      const fresh = (s.cursorSeq == null ? source.segments.slice(-3) : source.segments.filter(seg => reset || seg.seq > s.cursorSeq)).slice(-90);
      const gap = s.cursorSeq != null && fresh[0]?.seq > s.cursorSeq + 1;
      for (const [index, seg] of fresh.entries()) add(s, { ...seg, discontinuity: seg.discontinuity || ((reset || gap) && index === 0) }, 'live');
      s.cursor = identity; s.cursorSeq = latest.seq; s.sourceAdvanced = now;
    } else if (now - (s.sourceAdvanced || s.created) > Math.max(30_000, s.target * 4000)) mode = 'offline';
    s.error = error;
    if (!mode) return s;
  }
  const looping = mode ? cardSegments(base, mode) : source.segments;
  mode ||= 'vodLive';
  if (s.loopMode !== mode || s.mode !== mode) { s.loopMode = mode; s.loopIndex = 0; s.nextAt = now; }
  // Catch up only a bounded window if a viewer paused for a long time.
  if (now - s.nextAt > 36_000) s.nextAt = now - 36_000;
  for (let i = 0; i < 19 && s.nextAt <= now + Math.max(4, s.target * 2) * 1000; i++) {
    const index = s.loopIndex % looping.length;
    const seg = looping[index];
    add(s, { ...seg, discontinuity: seg.discontinuity || index === 0 }, mode);
    s.loopIndex++; s.nextAt += seg.duration * 1000;
  }
  s.error = error;
  return s;
}
export function renderHls(state) {
  const first = state.segments[0];
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${state.target}`, `#EXT-X-MEDIA-SEQUENCE:${first?.n || 0}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${first ? first.ds - Number(first.disc) : 0}`];
  if ((first?.n || 0) === 0) lines.push('#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
  for (const seg of state.segments) {
    if (seg.disc) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(seg.key ? `#EXT-X-KEY:METHOD=AES-128,URI="${seg.key.url}",IV=${seg.key.iv}` : '#EXT-X-KEY:METHOD=NONE');
    lines.push(`#EXTINF:${seg.duration.toFixed(6)},${state.title || "Mizanora IPTV"}`, seg.url);
  }
  return lines.join('\n') + '\n'; // Deliberately no ENDLIST: cards are live.
}
export async function startHls(base, payload, media, url, { fallback = '', intro = true } = {}) {
  await pruneHlsSessions().catch(() => {});
  const id = crypto.randomBytes(18).toString('hex');
  let now = Date.now();
  let source = null, error = '';
  if (!fallback) {
    // Do not download a raw video just to discover that it is not stitchable.
    if (/\.(?:mp4|mkv|mpd|ts)(?:$|[?#])/i.test(url)) return url;
    try { source = await loadHls(url); } catch (e) { if (useDirect(e)) return url; error = e.message; }
  }
  now = Date.now(); // Start the intro clock after bounded upstream discovery.
  const ttl = payload.preview ? Math.max(1, Math.min(900, payload.exp - Math.floor(now / 1000))) : PLAYOUT_TTL;
  const session = { created: now, expires: Math.floor(now / 1000) + Math.min(ttl, 6 * 3600), user: payload.u,
    inputUrl: url, mediaUrl: source?.mediaUrl || "", mediaId: media.id, title: String(media.title || "Mizanora IPTV").replace(/[\r\n]/g, " ").slice(0, 120), target: source?.target || 2, intro: intro && !fallback ? 8 : 0,
    segments: [], next: 0, discontinuities: 0, mode: '', error, sourceAdvanced: now };
  const initial = advanceHls(session, { now, source, fallback, base, error });
  await rtdbTransaction(`hlsSessions/${id}`, () => initial);
  const token = signPayload({ u: payload.u, f: payload.f, k: payload.k || 'live', hid: id, ...(payload.cv ? { cv: payload.cv } : {}), ...(payload.preview ? { preview: true, card: payload.card || '' } : {}) }, SECRET, ttl);
  return `${base}/playout/${encodeURIComponent(token)}/index.m3u8`;
}
export async function serveHls(base, payload, url, fallback = '') {
  if (!/^[a-f0-9]{36}$/.test(payload.hid || '')) throw problem('Invalid playout session');
  const path = `hlsSessions/${payload.hid}`;
  const record = await rtdbGet(path, { useCache: false });
  if (!record || record.user !== payload.u || record.expires * 1000 <= Date.now()) throw Object.assign(new Error('Playout session expired; retune channel'), { status: 410 });
  let source = null, error = '';
  if (!fallback) {
    try {
      source = await loadHls(record.inputUrl === url && record.mediaUrl ? record.mediaUrl : url);
      // TARGETDURATION is immutable. Preserve a changed provider playlist by
      // handing it to the device, rather than reporting a healthy feed offline.
      if (source.target > record.target) return { redirect: url, mode: 'direct', reason: 'target-duration-change' };
    } catch (e) {
      if (useDirect(e)) return { redirect: url, mode: 'direct', reason: 'source-compatibility' };
      // A pinned rendition may disappear while the master remains healthy.
      if (record.mediaUrl && record.mediaUrl !== url) {
        try { clearHlsCache(); source = await loadHls(url); } catch (retry) { if (useDirect(retry)) return { redirect: url, mode: 'direct', reason: 'source-compatibility' }; source = null; error = retry.message; }
        if (source?.target > record.target) return { redirect: url, mode: 'direct', reason: 'target-duration-change' };
      } else { source = null; error = e.message; }
    }
  }
  const result = await rtdbTransaction(path, latest => {
    if (!latest || latest.user !== payload.u) throw problem('Session unavailable');
    const updated = advanceHls(latest, { now: Date.now(), source, fallback, base, error });
    updated.expires = Math.min(payload.exp, Math.floor(Date.now() / 1000) + 6 * 3600);
    if (source?.mediaUrl) { updated.inputUrl = url; updated.mediaUrl = source.mediaUrl; }
    return updated;
  });
  return { manifest: renderHls(result), mode: result.mode, error: result.error };
}
