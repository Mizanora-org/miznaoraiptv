/** Real HTTP serverless playout + deterministic timeline/security regression.
 * Optional FFMPEG env also decodes the stitched intro+source transport stream. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mizanora-playout-test-'));
process.env.MZ_RTDB_MIRROR = path.join(dir, 'database.json');
process.env.MZ_RTDB_OFFLINE = '1'; process.env.VERCEL = ''; process.env.MZ_REQUIRE_PERSISTENCE = '';
delete process.env.MZ_GATEWAY_URL; delete process.env.MZ_GATEWAY_SECRET;
const { parseHls, advanceHls, renderHls } = await import('../api/_lib/hls.js');
const { rtdbSet, rtdbGet, rtdbTransaction, pruneHlsSessions } = await import('../api/_lib/rtdb.js');
const { createAppServer } = await import('./dev-server.mjs');
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log('  ✓ ' + name); };
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
let sequence = 100, broken = false, segmentBroken = false;
const chunks = await Promise.all([0,1,2,3].map(i => fs.readFile(new URL(`../public/media/welcome/seg${i}.m2ts`, import.meta.url))));
const fixture = http.createServer((req, res) => {
  if (broken) { res.writeHead(503); return res.end('unavailable'); }
  if (req.url === '/master.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,CODECS="avc1.4d401f,mp4a.40.2"\nmedia/live.m3u8\n'); }
  if (req.url === '/media/live.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.end(`#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n` + [0,1,2].map(i => `#EXTINF:2,\n${sequence+i}.ts\n`).join(''));
  }
  const match = req.url.match(/\/(\d+)\.ts$/);
  if (match) { if (segmentBroken) { res.writeHead(404); return res.end(); } res.setHeader('Content-Type','video/mp2t'); return res.end(chunks[Number(match[1]) % 4]); }
  res.writeHead(404); res.end();
});
const upstream = await listen(fixture);
const app = createAppServer(), base = await listen(app);
async function post(action, body = {}, headers = {}) {
  const response = await fetch(base + '/api/panel', { method:'POST', headers:{'Content-Type':'application/json', ...headers}, body:JSON.stringify({action,...body}) });
  return { response, data: await response.json() };
}
try {
  const encrypted = parseHls('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXTINF:2,\nseg.ts\n', upstream+'/media/test.m3u8');
  check('AES-128 IV preserves upstream sequence after remapping', encrypted.segments[0].key.iv.endsWith('002a'));
  check('Relative keys and media resolve against final playlist URL', encrypted.segments[0].key.url === upstream+'/key' && encrypted.segments[0].url === upstream+'/media/seg.ts');
  for (const tag of ['#EXT-X-MAP:URI="init.mp4"', '#EXT-X-BYTERANGE:100@0', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"']) {
    assert.throws(() => parseHls(`#EXTM3U\n${tag}\n#EXTINF:2,\nseg.ts`, upstream));
  }
  check('Unsupported fMP4, byte ranges and DRM fail explicitly', true);
  assert.throws(() => parseHls('#EXTM3U\n#EXTINF:2,\nfile:///etc/passwd', upstream));
  check('Non-HTTP media URLs are rejected', true);
  const seed = { created:100000, expires:99999999, intro:8, segments:[], next:0, discontinuities:0, mode:'', target:2 };
  let state = seed;
  for (const now of [100000,102000,104000,106000]) state = advanceHls(state,{now,base});
  check('Four intro segments total exactly eight seconds', state.segments.length === 4 && state.segments.reduce((sum,s)=>sum+s.duration,0) === 8);
  const snapshot = JSON.stringify(state); state = advanceHls(state,{now:106000,base});
  check('Repeated refresh cannot duplicate intro segments', JSON.stringify(state) === snapshot);
  const source = { ended:false, segments:[{url:upstream+'/media/100.ts',duration:2,seq:100,key:null}] };
  state = advanceHls(state,{now:108000,base,source});
  check('Intro-to-live has discontinuity and monotonic sequence', state.mode === 'live' && state.segments.at(-1).disc && state.segments.at(-1).n === 4);
  state = advanceHls(state,{now:140000,base,source});
  check('Frozen source sequence switches to offline', state.mode === 'offline');
  const n = state.next; state = advanceHls(state,{now:142000,base,fallback:'recharge'});
  check('Offline-to-recharge never resets sequence', state.mode === 'recharge' && state.next > n);
  state = advanceHls(state,{now:180000,base,fallback:'comingSoon'});
  state = advanceHls(state,{now:230000,base,fallback:'comingSoon'});
  const manifest = renderHls(state);
  check('Loop playlists stay bounded and have no ENDLIST', state.segments.length <= 18 && !manifest.includes('#EXT-X-ENDLIST'));
  check('Loop rollover emits discontinuity sequence', manifest.includes('#EXT-X-DISCONTINUITY-SEQUENCE:') && state.discontinuities > 1);

  await rtdbSet('channels',[{id:'test_live',streamId:7001,channelNumber:7,name:'Playout test',status:'active',tier:'free',url:upstream+'/master.m3u8'}]);
  await rtdbSet('xtreamAccounts/test_viewer',{username:'test_viewer',password:'test_pass_123',status:'Active',expDate:Math.floor(Date.now()/1000)+3600});
  const response = await fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8');
  let text = await response.text(); const sessionUrl = response.url;
  check('Xtream resolves to Vercel media playlist, not external redirect', response.ok && sessionUrl.startsWith(base+'/playout/'));
  check('Initial response starts with intro segment zero only', text.includes('/welcome/seg0.ts') && !text.includes('/welcome/seg1.ts') && !text.includes('#EXT-X-ENDLIST'));
  const token = new URL(sessionUrl).pathname.split('/')[2];
  const claims = JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
  const recordPath = `hlsSessions/${claims.hid}`;
  await rtdbTransaction(recordPath, record => ({...record,created:record.created-9000}));
  let live = await fetch(sessionUrl); text = await live.text();
  check('Master is resolved to absolute media segments after intro', live.headers.get('x-mizanora-playout') === 'live' && text.includes(upstream+'/media/100.ts') && !text.includes('STREAM-INF'));
  check('Intro remains exactly four segments in stitched source window', (text.match(/\/welcome\/seg\d\.ts/g)||[]).length === 4);
  if (process.env.FFMPEG) {
    const playlist = path.join(dir,'stitched.m3u8'); await fs.writeFile(playlist,text+'#EXT-X-ENDLIST\n');
    const decoder = spawn(process.env.FFMPEG,['-hide_banner','-loglevel','error','-protocol_whitelist','file,http,https,tcp,tls,crypto','-i',playlist,'-t','12','-f','null','-'],{stdio:['ignore','ignore','pipe']});
    let errors=''; decoder.stderr.on('data',b=>errors+=b);
    const [code] = await once(decoder,'exit');
    assert.equal(code,0,errors); check('Real FFmpeg decodes stitched eight-second intro plus live media', code===0);
  }
  broken = true;
  let offline = await fetch(sessionUrl); text = await offline.text();
  check('Source HTTP failure becomes an offline live loop', offline.headers.get('x-mizanora-playout') === 'offline' && text.includes('/channel-offline/seg0.ts'));
  check('Dead upstream segment URLs leave fallback manifest', !text.includes(upstream+'/media/'));
  const offlineRecord = await rtdbGet(recordPath,{useCache:false});
  broken = false; sequence += 10;
  live = await fetch(sessionUrl); text = await live.text();
  check('Source recovery resumes live without resetting sequence', live.headers.get('x-mizanora-playout') === 'live' && text.includes('/media/110.ts') && (await rtdbGet(recordPath,{useCache:false})).next > offlineRecord.next);
  segmentBroken = true;
  offline = await fetch(sessionUrl);
  check('Reachable manifest with failed segment also goes offline', offline.headers.get('x-mizanora-playout') === 'offline'); segmentBroken = false;
  const account = await rtdbGet('xtreamAccounts/test_viewer');
  await rtdbSet('xtreamAccounts/test_viewer',{...account,expDate:1});
  const recharge = await fetch(sessionUrl); text=await recharge.text();
  check('Existing session changes to recharge when subscription expires', recharge.headers.get('x-mizanora-playout') === 'recharge' && text.includes('/pro-unlock/'));
  await rtdbSet('xtreamAccounts/test_viewer',{...account,status:'Suspended'});
  check('Suspension denies old session rather than granting fallback access',(await fetch(sessionUrl)).status===403);
  await rtdbSet('xtreamAccounts/test_viewer',account);
  const login = await post('admin/pin-login',{pin:'03062015326'});
  const headers = {'x-admin-token':login.data.token};
  check('Preview API rejects unauthenticated callers',(await post('admin/playout-preview',{card:'offline'})).response.status===401);
  for (const card of ['offline','recharge','comingSoon']) {
    const preview = await post('admin/playout-preview',{card},headers);
    const result = await fetch(preview.data.url), body = await result.text();
    check(`Owner can preview ${card} as a real live playlist`, result.ok && result.headers.get('x-mizanora-playout')===card && !body.includes('#EXT-X-ENDLIST'));
  }
  const previews = await Promise.all(Array.from({length:5},()=>fetch(sessionUrl).then(r=>r.text())));
  check('Concurrent refreshes produce valid bounded manifests', previews.every(p=>p.startsWith('#EXTM3U') && p.length<15000));
  await rtdbTransaction('hlsSessions/old',()=>({expires:1})); await pruneHlsSessions();
  check('Expired session cleanup removes stale records', !(await rtdbGet('hlsSessions/old',{useCache:false})));
  // Exercise production ETag retry/fail-closed semantics without external Firebase.
  const originalFetch = globalThis.fetch;
  const privateKey = generateKeyPairSync('rsa', {modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({client_email:'test@example.test',private_key:privateKey});
  process.env.MZ_RTDB_OFFLINE = ''; process.env.VERCEL = '1';
  let puts = 0, gets = 0, unavailable = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({access_token:'test-only-token',expires_in:3600}),{status:200});
    if (unavailable) return new Response('unavailable',{status:503});
    if (options.method === 'PUT') {
      puts++;
      if (puts === 1) return new Response('{}',{status:412});
      assert.equal(options.headers['if-match'],'"v2"');
      assert.equal(JSON.parse(options.body).next, 6);
      return new Response('{}',{status:200});
    }
    gets++;
    return new Response(JSON.stringify({next:gets===1?0:5}),{status:200,headers:{etag:gets===1?'"v1"':'"v2"'}});
  };
  try {
    const updated = await rtdbTransaction('hlsSessions/cas-test',record=>({...record,next:record.next+1}));
    check('Production transaction retries an ETag conflict using newest state', updated.next===6 && puts===2 && gets===2);
    unavailable = true;
    await assert.rejects(()=>rtdbTransaction('hlsSessions/cas-test',record=>record), /read failed/);
    check('Production transaction does not silently fall back to local disk', true);
  } finally {
    globalThis.fetch = originalFetch; delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    process.env.MZ_RTDB_OFFLINE='1'; process.env.VERCEL='';
  }
  console.log(`\n${checks}/${checks} serverless HLS checks passed`);
} finally {
  app.closeAllConnections(); fixture.closeAllConnections();
  await Promise.all([new Promise(resolve=>app.close(resolve)),new Promise(resolve=>fixture.close(resolve))]);
  await fs.rm(dir,{recursive:true,force:true});
}
