/** Optional stateful HLS worker. Run on a dedicated VPS, never in Vercel. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyPayload } from '../api/_lib/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = (message, status = 403) => Object.assign(new Error(message), { status });
export function validateOrigin(value, allowed, insecure = false) {
  const url = new URL(value);
  if (url.username || url.password || !['https:', ...(insecure ? ['http:'] : [])].includes(url.protocol) || !allowed.has(url.origin)) throw fail('Origin is not allowed');
  return url;
}
export async function createGateway(options = {}) {
  const secret = options.secret || process.env.MZ_GATEWAY_SECRET || '';
  if (secret.length < 32) throw new Error('MZ_GATEWAY_SECRET must contain at least 32 characters');
  const insecure = options.insecure === true;
  const apps = new Set(options.appOrigins || (process.env.MZ_APP_ORIGINS || '').split(',').filter(Boolean));
  const sources = new Set(options.sourceOrigins || (process.env.MZ_SOURCE_ORIGINS || '').split(',').filter(Boolean));
  if (!apps.size || !sources.size) throw new Error('Set exact MZ_APP_ORIGINS and MZ_SOURCE_ORIGINS');
  const ffmpeg = options.ffmpeg || process.env.FFMPEG || 'ffmpeg';
  const maxSessions = Number(options.maxSessions || process.env.MZ_GATEWAY_MAX_SESSIONS || 4);
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100) throw new Error('Session capacity must be an integer from 1 to 100');
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'mizanora-gateway-'));
  const sessions = new Map();
  async function authorize(callback) {
    validateOrigin(callback, apps, insecure);
    const response = await fetch(callback, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'x-mizanora-gateway': secret } });
    if (!response.ok) throw fail('Subscription authorization failed');
    const data = await response.json();
    if (!data.ok || !Number.isFinite(data.expires) || data.expires * 1000 <= Date.now()) throw fail('Session expired');
    validateOrigin(data.url, sources, insecure);
    return data;
  }
  async function stop(session) {
    if (session.closed) return;
    session.closed = true; sessions.delete(session.id);
    if (session.process) {
      const child = session.process;
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(2000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(session.dir, { recursive: true, force: true });
  }
  function encode(session, mode) {
    if (session.closed) return;
    session.mode = mode; session.lastProgress = Date.now();
    const local = mode !== 'live';
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
    if (local) args.push('-re', ...(mode === 'offline' ? ['-stream_loop', '-1'] : []), '-i', path.join(ROOT, 'public/media', mode === 'intro' ? 'welcome' : 'channel-offline', 'video.mp4'));
    else args.push('-rw_timeout', '15000000', '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-i', session.data.url);
    // All transitions use the same codec/frame rate and independent 2s GOPs.
    // textfile + expansion=none keeps channel names out of FFmpeg expressions.
    let filter = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25,setsar=1';
    if (local) filter += ',drawbox=x=65:y=500:w=1150:h=140:color=0x061c16:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=identity.txt:expansion=none:fontcolor=0xf4d58c:fontsize=22:x=88:y=515:line_spacing=10';
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-threads', '2', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k');
    if (mode === 'intro') args.push('-t', '8');
    args.push('-f', 'hls', '-hls_time', '2', '-hls_list_size', '12', '-hls_delete_threshold', '12', '-hls_flags', 'append_list+omit_endlist+delete_segments+independent_segments+discont_start+temp_file', '-hls_segment_filename', 'segment%09d.ts', 'index.m3u8');
    const child = spawn(ffmpeg, args, { cwd: session.dir, stdio: ['ignore', 'ignore', 'ignore'] });
    session.process = child;
    let ended = false;
    const next = (code = 1) => {
      if (ended) return; ended = true;
      if (session.closed) return;
      if (mode === 'intro' && code !== 0) stop(session).catch(() => {});
      else if (mode === 'intro') encode(session, session.data.offline ? 'offline' : 'live');
      else if (mode === 'live') encode(session, 'offline');
      else stop(session).catch(() => {}); // Failed local card: do not spin processes.
    };
    child.once('exit', next); child.once('error', next);
  }
  let maintaining = false;
  const timer = setInterval(async () => {
    if (maintaining) return;
    maintaining = true;
    try {
      await Promise.all([...sessions.values()].map(async session => {
        if (session.closed) return;
        if (Date.now() - session.touched > 90_000 || session.data.expires * 1000 <= Date.now()) return stop(session);
        if (Date.now() - session.checked > 20_000) {
          session.checked = Date.now();
          try { session.data = await authorize(session.callback); } catch { return stop(session); }
          if (session.data.offline && session.mode === 'live') session.process?.kill('SIGTERM');
        }
        const stat = await fs.stat(path.join(session.dir, 'index.m3u8')).catch(() => null);
        if (stat && stat.mtimeMs > session.lastProgress) session.lastProgress = stat.mtimeMs;
        if (Date.now() - session.lastProgress > 20_000) {
          if (session.mode === 'live') session.process?.kill('SIGKILL');
          else await stop(session);
        }
      }));
    } finally { maintaining = false; }
  }, 2000);
  timer.unref();
  let starting = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) throw fail('Method not allowed', 405);
      const url = new URL(req.url, 'http://gateway');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (url.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, sessions: sessions.size, capacity: maxSessions })); }
      if (url.pathname === '/start') {
        const ticket = verifyPayload(url.searchParams.get('ticket'), secret);
        if (!ticket?.callback) throw fail('Invalid gateway ticket');
        if (sessions.size + starting >= maxSessions) throw fail('Media capacity reached', 503);
        starting++;
        let session;
        try {
          const data = await authorize(ticket.callback);
          const id = randomBytes(24).toString('hex'), dir = path.join(workspace, id);
          await fs.mkdir(dir);
          const clean = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 88);
          await fs.writeFile(path.join(dir, 'identity.txt'), `${clean(data.title)}\n${clean(data.payment)}\nRecharge / reseller support: ${clean(data.contact)}`);
          session = { id, dir, callback: ticket.callback, data, touched: Date.now(), checked: Date.now(), closed: false };
          sessions.set(id, session); encode(session, 'intro');
          for (let i = 0; i < 100; i++) {
            if (session.closed) throw fail('Media encoder unavailable', 503);
            if (await fs.stat(path.join(dir, 'index.m3u8')).catch(() => null)) break;
            await pause(100);
          }
          if (!await fs.stat(path.join(dir, 'index.m3u8')).catch(() => null)) throw fail('Encoder startup timed out', 503);
          res.writeHead(302, { Location: `/hls/${id}/index.m3u8` }); return res.end();
        } catch (error) { if (session) await stop(session); throw error; }
        finally { starting--; }
      }
      const match = url.pathname.match(/^\/hls\/([a-f0-9]{48})\/(index\.m3u8|segment\d{9}\.ts)$/);
      if (!match) throw fail('Not found', 404);
      const session = sessions.get(match[1]);
      if (!session || session.closed || session.data.expires * 1000 <= Date.now()) throw fail('Session unavailable', 410);
      session.touched = Date.now();
      const content = await fs.readFile(path.join(session.dir, match[2])).catch(() => { throw fail('Segment not available', 404); });
      res.setHeader('Content-Type', match[2].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
      res.setHeader('Content-Length', content.length);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.status ? error.message : 'Media gateway failed' }));
    }
  });
  return { server, sessions, async close() { clearInterval(timer); await Promise.all([...sessions.values()].map(stop)); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(workspace, { recursive: true, force: true }); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gateway = await createGateway();
  gateway.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Mizanora media gateway listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.close().then(() => process.exit(0)));
}
