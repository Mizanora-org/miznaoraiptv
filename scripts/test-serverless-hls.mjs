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
const { parseHls, advanceHls, renderHls, loadHls, clearHlsCache } = await import('../api/_lib/hls.js');
const { rtdbSet, rtdbGet, rtdbTransaction, pruneHlsSessions } = await import('../api/_lib/rtdb.js');
const { createAppServer } = await import('./dev-server.mjs');
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log('  ✓ ' + name); };
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
let sequence = 100, broken = false, segmentBroken = false, playlistRequests = 0;
const chunks = await Promise.all([0,1,2,3].map(i => fs.readFile(new URL(`../public/media/welcome/seg${i}.m2ts`, import.meta.url))));
const fixture = http.createServer((req, res) => {
  if (broken) { res.writeHead(503); return res.end('unavailable'); }
  if (req.url.endsWith('.m3u8')) playlistRequests++;
  if (req.url === '/fragmented.m3u8') return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg.m4s\n');
  if (req.url === '/audio.m3u8') return res.end('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="audio"\nvideo/index.m3u8\n');
  if (req.url === '/blocked.m3u8') { res.writeHead(403); return res.end('server location blocked'); }
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
  const declared = parseHls('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.004,\nseg.ts\n', upstream);
  check('RFC-rounded segment variation does not change declared target duration', declared.target === 6);
  clearHlsCache(); const beforeRequests = playlistRequests;
  await Promise.all(Array.from({length:10},()=>loadHls(upstream+'/master.m3u8')));
  check('Concurrent source discovery coalesces master and variant requests', playlistRequests - beforeRequests === 2);
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

  // Accelerated 72-hour timeline, not a claim of a real three-day device soak.
  let longState = { ...seed, intro:0, target:6, segments:[] }, lastNumber=-1;
  for (let tick=0; tick<=21600; tick++) {
    const first=100+tick*2;
    const moving = { ended:false, target:6, segments:Array.from({length:6},(_,i)=>({seq:first+i,url:`${upstream}/${first+i}.ts`,duration:6,key:null})) };
    longState=advanceHls(longState,{now:100000+tick*12000,base,source:moving});
    assert.equal(longState.mode,'live'); assert.ok(longState.next>lastNumber); lastNumber=longState.next;
    assert.ok(longState.segments.length<=18);
  }
  check('Simulated 72-hour stream keeps monotonic sequence and bounded memory', true);
  let catchup = advanceHls({...seed,intro:0},{now:100000,base,source:{ended:false,segments:[{seq:1,url:upstream+'/1.ts',duration:2}]}});
  catchup=advanceHls(catchup,{now:110000,base,source:{ended:false,segments:[2,3,4,5,6].map(seq=>({seq,url:`${upstream}/${seq}.ts`,duration:2}))}});
  check('Delayed refresh does not discard segments beyond the last three', catchup.segments.slice(-5).map(s=>s.seq).join(',')==='2,3,4,5,6');
  const countBefore=catchup.next;
  catchup=advanceHls(catchup,{now:112000,base,source:{ended:false,segments:[{seq:6,url:upstream+'/6.ts?token=rotated',duration:2}]}});
  check('Rotating URL signatures do not duplicate the same media sequence', catchup.next===countBefore);

  await rtdbSet('channels',[{id:'test_live',streamId:7001,channelNumber:7,name:'Playout test',status:'active',tier:'free',url:upstream+'/master.m3u8'}]);
  await rtdbSet('xtreamAccounts/test_viewer',{username:'test_viewer',password:'test_pass_123',status:'Active',expDate:Math.floor(Date.now()/1000)+3600});
  const response = await fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8');
  let text = await response.text(); const sessionUrl = response.url;
  check('Xtream resolves to Vercel media playlist, not external redirect', response.ok && sessionUrl.startsWith(base+'/playout/'));
  check('Startup prebuffers all eight intro seconds and live media', text.includes('/welcome/seg0.ts') && text.includes('/welcome/seg3.ts') && text.includes('/media/100.ts') && !text.includes('#EXT-X-ENDLIST'));
  const startupManifest = text;
  const token = new URL(sessionUrl).pathname.split('/')[2];
  const claims = JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
  const recordPath = `hlsSessions/${claims.hid}`;
  check('Session capability lasts seven days, not four hours', claims.exp - claims.iat === 7*86400);
  await rtdbTransaction(recordPath, record => ({...record,created:record.created-9000}));
  let live = await fetch(sessionUrl); text = await live.text();
  check('Master is resolved to absolute media segments after intro', live.headers.get('x-mizanora-playout') === 'live' && text.includes(upstream+'/media/100.ts') && !text.includes('STREAM-INF'));
  check('Reloading the final playout URL after intro cannot rewind into the bumper', !text.includes('/media/welcome/') && !text.includes('#EXT-X-START:TIME-OFFSET=0'));
  check('Initial stitched window still contains exactly four intro segments', (startupManifest.match(/\/welcome\/seg\d\.ts/g)||[]).length === 4);
  if (process.env.FFMPEG) {
    const playlist = path.join(dir,'stitched.m3u8'); await fs.writeFile(playlist,startupManifest+'#EXT-X-ENDLIST\n');
    const decoder = spawn(process.env.FFMPEG,['-hide_banner','-loglevel','error','-protocol_whitelist','file,http,https,tcp,tls,crypto','-i',playlist,'-t','12','-f','null','-'],{stdio:['ignore','ignore','pipe']});
    let errors=''; decoder.stderr.on('data',b=>errors+=b);
    const [code] = await once(decoder,'exit');
    assert.equal(code,0,errors); check('Real FFmpeg decodes stitched eight-second intro plus live media', code===0);
  }
  broken = true; clearHlsCache();
  let transient = await fetch(sessionUrl);
  check('Transient manifest failure preserves healthy buffered media', transient.headers.get('x-mizanora-playout') === 'live');
  await rtdbTransaction(recordPath, record => ({...record,failureSince:Date.now()-20000}));
  let offline = await fetch(sessionUrl); text = await offline.text();
  check('Source HTTP failure becomes an offline live loop', offline.headers.get('x-mizanora-playout') === 'offline' && text.includes('/channel-offline/seg0.ts'));
  check('Dead upstream segment URLs leave fallback manifest', !text.includes(upstream+'/media/'));
  const offlineRecord = await rtdbGet(recordPath,{useCache:false});
  broken = false; sequence += 10; clearHlsCache();
  live = await fetch(sessionUrl); text = await live.text();
  check('Source recovery resumes live without resetting sequence', live.headers.get('x-mizanora-playout') === 'live' && text.includes('/media/110.ts') && (await rtdbGet(recordPath,{useCache:false})).next > offlineRecord.next);
  segmentBroken = true;
  offline = await fetch(sessionUrl);
  check('Server-side segment access is not a false-offline gate', offline.headers.get('x-mizanora-playout') === 'live'); segmentBroken = false;
  const account = await rtdbGet('xtreamAccounts/test_viewer');
  await rtdbSet('xtreamAccounts/test_viewer',{...account,expDate:1});
  const recharge = await fetch(sessionUrl); text=await recharge.text();
  check('Existing session changes to recharge when subscription expires', recharge.headers.get('x-mizanora-playout') === 'recharge' && text.includes('/pro-unlock/'));
  await rtdbSet('xtreamAccounts/test_viewer',{...account,status:'Suspended'});
  check('Suspension denies old session rather than granting fallback access',(await fetch(sessionUrl)).status===403);
  await rtdbSet('xtreamAccounts/test_viewer',account);
  await rtdbSet('xtreamAccounts/test_viewer',{...account,password:'changed_password'});
  check('Password changes revoke the long-lived playlist capability', (await fetch(sessionUrl)).status===403);
  await rtdbSet('xtreamAccounts/test_viewer',account);
  const lifetime = await rtdbGet(recordPath,{useCache:false});
  check('Active long sessions keep a bounded six-hour idle record expiry', lifetime.expires <= Math.floor(Date.now()/1000)+6*3600);
  const login = await post('admin/pin-login',{pin:'03062015326'});
  const headers = {'x-admin-token':login.data.token};
  check('Preview API rejects unauthenticated callers',(await post('admin/playout-preview',{card:'offline'})).response.status===401);
  for (const card of ['offline','recharge','comingSoon']) {
    const preview = await post('admin/playout-preview',{card},headers);
    const result = await fetch(preview.data.url), body = await result.text();
    check(`Owner can preview ${card} as a real live playlist`, result.ok && result.headers.get('x-mizanora-playout')===card && !body.includes('#EXT-X-ENDLIST'));
  }
  const baseChannel={id:'test_live',streamId:7001,channelNumber:7,name:'Playout test',status:'active',tier:'free'};
  for (const file of ['fragmented.m3u8','audio.m3u8','blocked.m3u8']) {
    await rtdbSet('channels',[{...baseChannel,url:upstream+'/'+file}]); clearHlsCache();
    const entry = await fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8',{redirect:'manual'});
    const resolved = await fetch(entry.headers.get('location'),{redirect:'manual'});
    check(`${file} preserves provider playback rather than false offline`, resolved.status===302 && resolved.headers.get('location')===upstream+'/'+file && resolved.headers.get('x-mizanora-playout')==='direct');
  }
  await rtdbSet('channels',[{...baseChannel,url:upstream+'/master.m3u8',playbackMode:'direct'}]);
  const direct = await fetch(sessionUrl,{redirect:'manual'});
  check('Owner can move an existing session to per-channel direct mode', direct.status===302 && direct.headers.get('location')===upstream+'/master.m3u8');
  await rtdbSet('channels',[{...baseChannel,url:upstream+'/master.m3u8'}]); clearHlsCache();
  await rtdbTransaction(recordPath,record=>({...record,target:1}));
  const changed = await fetch(sessionUrl,{redirect:'manual'});
  check('Genuine target-duration changes pass through rather than force offline', changed.status===302 && changed.headers.get('x-mizanora-reason')==='target-duration-change');
  await rtdbTransaction(recordPath,record=>({...record,target:2}));
  const { guideWithAvailability, parseXmlTv } = await import('../api/_lib/epg.js');
  const at = Date.now(), programme = {channelId:'test_live',start:at-1000,stop:at+3600000,title:'Real news'};
  const notices = guideWithAvailability(baseChannel,[programme],at);
  check('Guide placeholders never overlap real programmes', notices.filter(p=>p.placeholder).every(p=>p.stop<=programme.start || p.start>=programme.stop));
  check('Real programme titles are preserved alongside labelled gap notices', notices.some(p=>p.title==='Real news') && notices.some(p=>p.title==='Schedule unavailable'));
  const short = await (await fetch(base+'/player_api.php?username=test_viewer&password=test_pass_123&action=get_short_epg&stream_id=7001')).json();
  check('Unmapped channel has an explicitly marked short-EPG availability notice', short.epg_listings[0]?.is_placeholder===1 && Buffer.from(short.epg_listings[0].title,'base64').toString()==='Schedule unavailable');
  const xml=await (await fetch(base+'/xmltv.php?username=test_viewer&password=test_pass_123')).text();
  const parsedGuide=parseXmlTv(xml);
  check('XMLTV declares the channel and labelled programmes without external EPG', parsedGuide.channels.some(c=>c.id==='test_live') && parsedGuide.programmes.some(p=>p.channelId==='test_live' && p.title==='Schedule unavailable'));
  const previews = await Promise.all(Array.from({length:5},()=>fetch(sessionUrl).then(r=>r.text())));
  check('Concurrent refreshes produce valid bounded manifests', previews.every(p=>p.startsWith('#EXTM3U') && p.length<15000));
  await rtdbTransaction('hlsSessions/old',()=>({expires:1})); await pruneHlsSessions();
  check('Expired session cleanup removes stale records', !(await rtdbGet('hlsSessions/old',{useCache:false})));
  // Reopening the original Xtream entry must resume, not mint a new bumper.
  const beforeResume = await rtdbGet(recordPath,{useCache:false});
  const reconnects = await Promise.all(Array.from({length:3},()=>fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8')));
  for (const reopened of reconnects) {
    const resumedToken = new URL(reopened.url).pathname.split('/')[2];
    const resumedClaims = JSON.parse(Buffer.from(resumedToken.split('.')[0],'base64url').toString());
    assert.equal(resumedClaims.hid, claims.hid); assert.equal(resumedClaims.gen, claims.gen);
    const manifest = await reopened.text();
    assert.ok(!manifest.includes('/media/welcome/'));
    assert.ok(!manifest.includes('#EXT-X-START:TIME-OFFSET=0'));
  }
  check('Repeated/concurrent Xtream reconnects resume the same generation without replaying intro', true);
  const afterResume = await rtdbGet(recordPath,{useCache:false});
  check('Reconnect preserves media and discontinuity sequence rather than resetting', afterResume.next>=beforeResume.next && afterResume.discontinuities>=beforeResume.discontinuities && afterResume.segments[0].n>=4);
  const secondPlayer = await fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8',{headers:{'user-agent':'Distinct-player-test'}});
  const secondClaims = JSON.parse(Buffer.from(new URL(secondPlayer.url).pathname.split('/')[2].split('.')[0],'base64url').toString());
  check('Different player identity starts a separate playout session', secondClaims.hid!==claims.hid && (await secondPlayer.text()).includes('/media/welcome/'));
  await rtdbTransaction(recordPath, record=>({...record,lastAccessAt:Date.now()-125000}));
  const retuned = await fetch(base+'/live/test_viewer/test_pass_123/7001.m3u8');
  const retuneClaims = JSON.parse(Buffer.from(new URL(retuned.url).pathname.split('/')[2].split('.')[0],'base64url').toString());
  check('An idle retune starts a new generation with one fresh intro', retuneClaims.gen!==claims.gen && (await retuned.text()).includes('/media/welcome/'));
  check('Old generation tokens cannot attach to the new retune', (await fetch(sessionUrl)).status===410);
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
