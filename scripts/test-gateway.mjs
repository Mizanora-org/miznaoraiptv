/** Stateful real-FFmpeg integration. FFMPEG=/path/to/ffmpeg npm run test:gateway */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createGateway, validateOrigin } from '../gateway/server.mjs';
import { signPayload } from '../api/_lib/util.js';
const secret = 'gateway-test-secret-at-least-32-characters';
let active = true, sourceRequests = 0;
const mp4 = await fs.readFile(new URL('../public/media/welcome/video.mp4', import.meta.url));
const fixture = http.createServer((req, res) => {
  if (req.url === '/authorize') {
    if (req.headers['x-mizanora-gateway'] !== secret || !active) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, url: origin + '/source.mp4', title: '#7 Gateway Test', payment: 'Configured payment', contact: 'Test support', expires: Math.floor(Date.now()/1000) + 3600 }));
  }
  sourceRequests++; res.setHeader('Content-Type', 'video/mp4'); res.end(mp4);
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const origin = `http://127.0.0.1:${fixture.address().port}`;
const gateway = await createGateway({ secret, appOrigins: [origin], sourceOrigins: [origin], insecure: true, maxSessions: 1 });
gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
const base = `http://127.0.0.1:${gateway.server.address().port}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  assert.throws(() => validateOrigin('http://127.0.0.1/a', new Set(['http://127.0.0.1'])));
  assert.throws(() => validateOrigin('https://other.test/a', new Set(['https://trusted.test'])));
  assert.equal((await fetch(base + '/start?ticket=bad')).status, 403);
  const ticket = signPayload({ callback: origin + '/authorize' }, secret, 60);
  const response = await fetch(base + '/start?ticket=' + ticket, { redirect: 'manual' });
  assert.equal(response.status, 302, await response.text());
  const playlistUrl = base + response.headers.get('location');
  let manifest = await (await fetch(playlistUrl)).text();
  assert.match(manifest, /#EXTINF:2\.000000/);
  assert.equal(sourceRequests, 0, 'Intro starts before any live fetch');
  const segment = manifest.split('\n').find(line => line.endsWith('.ts'));
  const segmentUrl = new URL(segment, playlistUrl).href;
  assert.equal((await fetch(segmentUrl)).status, 200);
  assert.equal((await fetch(base + '/start?ticket=' + ticket)).status, 503, 'Capacity enforced');
  // Decode the actual intro transport stream, not just its filename.
  const decoder = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', segmentUrl, '-f', 'null', '-'], { stdio: 'ignore' });
  assert.equal((await once(decoder, 'exit'))[0], 0, 'Intro segment decodes');
  for (let i = 0; i < 50 && [...gateway.sessions.values()][0]?.mode !== 'offline'; i++) await wait(400);
  assert.ok(sourceRequests > 0, 'Source starts after introduction');
  assert.equal([...gateway.sessions.values()][0]?.mode, 'offline', 'Source EOF switches to offline loop');
  await wait(3000);
  manifest = await (await fetch(playlistUrl)).text();
  assert.ok((manifest.match(/#EXT-X-DISCONTINUITY\n/g) || []).length >= 2, 'Transitions include HLS discontinuities');
  assert.match(manifest, /segment000000000\.ts/, 'Intro has not been skipped at transition');
  const durations = [...manifest.matchAll(/#EXTINF:([0-9.]+)/g)].map(match => Number(match[1]));
  assert.equal(durations.slice(0, 4).reduce((sum, n) => sum + n, 0), 8, 'Four intro segments total exactly eight seconds');
  assert.equal((await fetch(base + '/hls/' + 'a'.repeat(48) + '/index.m3u8')).status, 410);
  active = false;
  for (let i = 0; i < 65 && gateway.sessions.size; i++) await wait(400);
  assert.equal(gateway.sessions.size, 0, 'Revoked subscription terminates session');
  assert.equal((await fetch(playlistUrl)).status, 410);
  console.log('Gateway checks passed: ticket/allowlist/capacity, real intro decode, live transition, offline loop, discontinuities, revocation and cleanup.');
} finally {
  await gateway.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
}
