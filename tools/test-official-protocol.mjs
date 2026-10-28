// Optional network-dependent check: run the current public game's actual link,
// mesh and room classes against a LOCAL HTTP signalling server. No game account,
// official room or public-network/NAT test is created by this tool.
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const origin = 'https://pokebonk.com';
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Upstream HTTP ${response.status}`);
  return response.text();
}
const html = await download(origin);
const entry = html.match(/src="([^\"]*\/assets\/main-[^\"]+\.js)"/)?.[1];
if (!entry) throw Error('Upstream entry changed');
const bootstrap = await download(new URL(entry, origin));
let source = null, asset = null, profile = null;
// Minified names are intentionally pinned to reviewed upstream layouts. An
// unrecognised layout fails instead of silently exercising a stale mock.
const profiles = [
  { build: 'zn', link: 'pF', mesh: 'mF', room: 'wF', afterMesh: 'hF', afterRoom: 'TF', support: 'const eF=[], $P=()=>typeof RTCPeerConnection===\'function\';',
    constants: ['tF','nF','rF','iF','aF','oF','sF','cF','lF','uF','dF','fF','hF','gF','_F','vF','yF','bF','xF','SF','zS'] },
  { link: 'ZP', mesh: 'QP', room: 'cF', afterMesh: '$P', afterRoom: 'lF', support: 'const RP=[], LP=()=>typeof RTCPeerConnection===\'function\';',
    constants: ['zP','BP','VP','HP','UP','WP','GP','KP','qP','JP','YP','XP','$P','eF','tF','nF','rF','iF','aF','oF','ES'] },
  { link: 'BP', mesh: 'VP', room: 'ZP', afterMesh: 'HP', afterRoom: 'QP', support: 'const OP=[], DP=()=>typeof RTCPeerConnection===\'function\';',
    constants: ['kP','AP','jP','MP','NP','PP','FP','IP','LP','RP','zP','HP','UP','WP','GP','KP','qP','JP','YP','bS'] },
];
for (const name of [...new Set(Array.from(bootstrap.matchAll(/["'`]\.\/(main-[^"'`/]+\.js)["'`]/g), m => m[1]))]) {
  const text = await download(`${origin}/assets/${name}`);
  const match = profiles.find(item => [item.link,item.mesh,item.room].every(id=>text.includes(id+'=class')) && text.includes('retryLink('));
  if (match) { source = text; asset = name; profile = match; break; }
}
if (!source) throw Error('Upstream class layout changed; review is required');
const bp = source.indexOf(profile.link+'=class'), vp = source.indexOf(','+profile.mesh+'=class', bp);
const hp = source.indexOf(','+profile.afterMesh+'=', vp), zp = source.indexOf(profile.room+'=class', hp), qp = source.indexOf(','+profile.afterRoom+'=', zp);
if ([bp, vp, hp, zp, qp].some(index => index < 0)) throw Error('Upstream boundaries changed');
const constants = {};
for (const key of profile.constants) {
  const escaped = key.replace(/[$]/g, '\\$');
  const literal = source.match(new RegExp(`(?:^|[,;])${escaped}=([0-9.]+(?:e[+-]?[0-9]+)?)[,;]`))?.[1];
  if (!literal) throw Error(`Missing native constant ${key}`);
  constants[key] = Number(literal);
}
const nativeClasses = `
  const A=(object,key,value)=>(Object.defineProperty(object,key,{value,writable:true,configurable:true,enumerable:true}),object);
  const c=value=>value, ${profile.build || 'jn'}='local-protocol-test'; ${profile.support}
  const {${Object.keys(constants).join(',')}}=${JSON.stringify(constants)};
  const ${source.slice(bp, vp)};
  const ${source.slice(vp + 1, hp)};
  const ${source.slice(zp, qp)};
  const NativeRoom=${profile.room};
`;
const runtime = `${nativeClasses}
  export function start(id,group) {
    const request=(route,body)=>fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}).then(response=>{if(!response.ok)throw Error('Local HTTP '+response.status);return response.json()});
    const backend={
      coopSignal:(acc,code,to,kind,data)=>request('/signal',{group,from:id,to,kind,data}),
      coopPoll:(acc,code,after)=>request('/poll?group='+group+'&id='+id+'&after='+after),
      coopLeave:()=>Promise.resolve(),coopIce:()=>Promise.resolve({servers:[]})
    };
    return request('/poll?group='+group+'&id='+id+'&after=0').then(payload=>{
      window.nativeRoom=new NativeRoom(backend,{},payload,[]);
      window.nativeMessages=[];nativeRoom.ev.ctl=(peer,message)=>{if(message?.t==='probe')nativeMessages.push(message.value)};
      if(window.__pbCoopFix)window.__pbCoopFix.attachRoom(nativeRoom);
      return true;
    });
  }
`;
const groups = new Map();
function groupFor(name) {
  if (!groups.has(name)) groups.set(name, { next: 0, signals: [], pendingDelayed: [], posted: { offer: 0, answer: 0, bye: 0 }, holdNextAnswer: 0, holdNextBye: 0, holdAnswers: [], delayedDelivered: 0 });
  return groups.get(name);
}
function payload(group, id, after) {
  return { me: id, room: { code: 'TEST', version: 1, host: 'left', state: 'lobby', members: [{ id: 'left', slot: 0 }, { id: 'right', slot: 1 }] },
    signals: group.signals.filter(signal => signal.to === id && signal.id > after && signal.readyAt <= Date.now()).map(({ readyAt, ...signal }) => signal) };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value, type = 'application/json') => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    if (url.pathname === '/runtime.mjs') { send(runtime, 'text/javascript'); return; }
    if (url.pathname === '/signal') {
      let text = ''; for await (const chunk of req) text += chunk;
      const value = JSON.parse(text), group = groupFor(value.group);
      let hold = 0;
      if (value.kind === 'answer' && group.holdAnswers.length) hold = group.holdAnswers.shift();
      else if (value.kind === 'answer' && group.holdNextAnswer) { hold = group.holdNextAnswer; group.holdNextAnswer = 0; }
      if (value.kind === 'bye' && group.holdNextBye) { hold = group.holdNextBye; group.holdNextBye = 0; }
      group.posted[value.kind]++;
      // Signal IDs become visible in acceptance order, like an ordered poll log.
      const deliver = () => group.signals.push({ id: ++group.next, from: value.from, to: value.to, kind: value.kind, data: value.data, readyAt: Date.now() });
      if (hold) { group.pendingDelayed.push({ kind: value.kind, data: value.data }); setTimeout(() => { deliver(); group.delayedDelivered++; }, hold); } else deliver();
      send({}); return;
    }
    if (url.pathname === '/poll') {
      const group = groupFor(url.searchParams.get('group'));
      await new Promise(resolve => setTimeout(resolve, 600));
      send(payload(group, url.searchParams.get('id'), Number(url.searchParams.get('after')))); return;
    }
    send('<!doctype html><meta charset="utf-8"><title>Native protocol test</title><script type="module">import {start} from "/runtime.mjs";window.start=start;</script>', 'text/html');
  } catch (error) { res.writeHead(500); res.end('Local fixture error'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
async function waitOpen(pages, timeout = 30000) {
  await Promise.all(pages.map(([page, peer]) => page.waitForFunction(peer => nativeRoom.mesh.links.get(peer)?.state === 'open', peer, { timeout })));
}
async function verifyData(left, right, marker) {
  await right.evaluate(value => nativeRoom.mesh.sendCtl('left', { t: 'probe', value }), marker);
  await left.waitForFunction(value => nativeMessages.includes(value), marker, { timeout: 5000 });
}
try {
  for (const scenario of [
    { name: 'native-baseline', leftTool: false, rightTool: false, action: 'offerer-fail' },
    { name: 'answerer-only', leftTool: true, rightTool: false, action: 'answerer-fail' },
    { name: 'offerer-only', leftTool: false, rightTool: true, action: 'offerer-fail' },
    { name: 'both-simultaneous', leftTool: true, rightTool: true, action: 'both-fail' },
    { name: 'deleted-answerer', leftTool: true, rightTool: true, action: 'missing' },
    { name: 'late-old-answer', leftTool: true, rightTool: true, action: 'late-answer' },
    { name: 'late-old-bye', leftTool: true, rightTool: true, action: 'late-bye' },
    { name: 'old-answer-before-current-answer', leftTool: true, rightTool: true, action: 'stale-first' },
  ]) {
    const requested = process.argv.find(value => value.startsWith('--scenario='))?.split('=')[1];
    if (requested && requested !== scenario.name) continue;
    const leftContext = await browser.newContext(), rightContext = await browser.newContext();
    const left = await leftContext.newPage(), right = await rightContext.newPage();
    const pageErrors = [];
    for (const page of [left, right]) page.on('pageerror', error => { pageErrors.push(error.message); if (pageErrors.length <= 3) console.log(JSON.stringify({ scenario: scenario.name, pageError: error.message })); });
    if (scenario.leftTool) await left.addInitScript({ path: fileURLToPath(new URL('../pb-coop-fix.user.js', import.meta.url)) });
    if (scenario.rightTool) await right.addInitScript({ path: fileURLToPath(new URL('../pb-coop-fix.user.js', import.meta.url)) });
    try {
      await Promise.all([left.goto(base), right.goto(base)]);
      await Promise.all([left.waitForFunction(() => typeof start === 'function'), right.waitForFunction(() => typeof start === 'function')]);
      await left.evaluate(name => start('left', name), scenario.name);
      await right.evaluate(name => start('right', name), scenario.name);
      await waitOpen([[left, 'right'], [right, 'left']]);
      await verifyData(left, right, 'before-' + scenario.name);
      const started = Date.now();
      if (scenario.action === 'missing') {
        await left.evaluate(() => { nativeRoom.mesh.links.get('right').close(); nativeRoom.mesh.links.delete('right'); __pbCoopFix.repairNow(); });
      } else if (scenario.action === 'both-fail') {
        await Promise.all([left.evaluate(() => nativeRoom.mesh.links.get('right').fail()), right.evaluate(() => nativeRoom.mesh.links.get('left').fail())]);
      } else if (['late-answer', 'late-bye', 'stale-first'].includes(scenario.action)) {
        if (scenario.action === 'stale-first') {
          groupFor(scenario.name).holdAnswers = [4000, 8000];
          await Promise.all([left.evaluate(() => { __pbCoopFix.cfg.autoRepair = false; }), right.evaluate(() => { __pbCoopFix.cfg.autoRepair = false; })]);
        }
        else if (scenario.action === 'late-answer') groupFor(scenario.name).holdNextAnswer = 4500;
        else groupFor(scenario.name).holdNextBye = 4500;
        const count = groupFor(scenario.name).posted.answer;
        await left.evaluate(() => { nativeRoom.mesh.links.get('right').fail(); __pbCoopFix.repairNow(); });
        const deadline = Date.now() + 15000;
        if (scenario.action === 'late-answer' || scenario.action === 'stale-first') {
          while (groupFor(scenario.name).posted.answer === count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          if (groupFor(scenario.name).posted.answer === count) throw Error('Expected held answer was not produced');
        }
        await right.evaluate(() => { nativeRoom.mesh.links.get('left').fail(); __pbCoopFix.repairNow(); });
        if (scenario.action === 'stale-first') {
          const pending = groupFor(scenario.name).pendingDelayed.find(signal => signal.kind === 'answer');
          await right.evaluate(sdp => {
            const staleFragment = sdp.match(/^a=ice-ufrag:([^\r\n]+)/m)?.[1];
            const proto = RTCPeerConnection.prototype, original = proto.setRemoteDescription;
            window.staleAnswerApplied = false;
            proto.setRemoteDescription = function (description) {
              if (description?.type === 'answer' && description.sdp.match(/^a=ice-ufrag:([^\r\n]+)/m)?.[1] === staleFragment) window.staleAnswerApplied = true;
              return original.call(this, description);
            };
          }, pending.data);
          const deadline = Date.now() + 12000;
          while (!groupFor(scenario.name).delayedDelivered && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          const old = groupFor(scenario.name).signals.find(signal => signal.kind === 'answer' && signal.id === groupFor(scenario.name).next);
          if (!old) throw Error('Old answer was not delivered');
          await right.waitForFunction(id => nativeRoom.after >= id, old.id, { timeout: 10000 });
          const applied = await right.evaluate(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return window.staleAnswerApplied;
          });
          if (applied) throw Error('Stale answer was applied to a newer local offer before its actual answer arrived');
        }
      } else {
        const page = scenario.action === 'answerer-fail' ? left : right;
        const peer = scenario.action === 'answerer-fail' ? 'right' : 'left';
        await page.evaluate(peer => nativeRoom.mesh.links.get(peer).fail(), peer);
      }
      await waitOpen([[left, 'right'], [right, 'left']], 45000);
      await verifyData(left, right, 'after-' + scenario.name);
      if (scenario.action.startsWith('late-')) {
        const deadline = Date.now() + 12000;
        while (!groupFor(scenario.name).delayedDelivered && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!groupFor(scenario.name).delayedDelivered) throw Error('Delayed old signal was not delivered');
        // Ensure both clients have polled beyond the old signal before passing.
        const delivered = groupFor(scenario.name).signals.at(-1);
        const recipient = delivered.to === 'left' ? left : right;
        await recipient.waitForFunction(id => nativeRoom.after >= id, delivered.id, { timeout: 12000 });
        await waitOpen([[left, 'right'], [right, 'left']], 45000);
        await verifyData(left, right, 'after-delayed-delivery-' + scenario.name);
      }
      if (pageErrors.length) throw Error('Unexpected browser page errors: '+pageErrors.length);
      results.push({ scenario: scenario.name, result: 'PASS', recoveryMs: Date.now() - started, pageErrors: pageErrors.length });
    } catch (error) {
      results.push({ scenario: scenario.name, result: 'FAIL', error: error.message.split('\n')[0], left: await left.evaluate(() => window.__pbCoopFix?.diagnostics() ?? { state: window.nativeRoom?.mesh.links.get('right')?.state }).catch(() => null), right: await right.evaluate(() => window.__pbCoopFix?.diagnostics() ?? { state: window.nativeRoom?.mesh.links.get('left')?.state }).catch(() => null) });
    } finally { await leftContext.close(); await rightContext.close(); }
    console.log(JSON.stringify(results.at(-1)));
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { checkedAt: new Date().toISOString(), upstreamAsset: asset, upstreamSha256: createHash('sha256').update(source).digest('hex'),
  method: 'Actual upstream link/mesh/room classes, two isolated browser contexts, local HTTP polling/signalling with 600ms response delay',
  limitation: 'Not official server authentication, real game-state continuity, distinct devices or Internet/NAT/TURN validation', results };
fs.mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../artifacts/official-protocol-report.json', import.meta.url), JSON.stringify(report, null, 2));
if (!results.length || results.some(result => result.result !== 'PASS')) process.exitCode = 1;
