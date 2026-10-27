// Read-only compatibility hints. Never execute or redistribute the game bundle.
import { createHash } from 'node:crypto';
const origin = 'https://pokebonk.com';
async function read(url) {
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin) throw Error('Only official same-origin assets are allowed');
  const response = await fetch(parsed, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Upstream HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 8000000) throw Error('Unexpectedly large upstream asset');
  return text;
}
try {
  const html = await read(origin);
  const entry = html.match(/<script[^>]+src="([^\"]*\/assets\/main-[^\"]+\.js)"/i)?.[1];
  if (!entry) throw Error('Game entry module not found');
  const bootstrap = await read(entry);
  const candidates = [...new Set([entry, ...Array.from(bootstrap.matchAll(/["'`]\.\/(main-[^"'`/]+\.js)["'`]/g), m => `/assets/${m[1]}`)])];
  let bundle, url;
  for (const candidate of candidates.slice(0, 4)) {
    const text = candidate === entry ? bootstrap : await read(candidate);
    if (/export\{[^}]*\bas App\b/.test(text)) { bundle = text; url = new URL(candidate, origin).href; break; }
  }
  if (!bundle) throw Error('Exported App class not found');
  const checks = {
    appFrameGap: /frameGap\(\)/.test(bundle),
    appCoopRoom: /this\.coopRoom/.test(bundle),
    roomRetryLink: /retryLink\([^)]*\)\{this\.mesh\.retry/.test(bundle),
    roomSchedule: /schedule\([^)]*\)\{if\(!this\.alive\)/.test(bundle),
    roomHurryPoll: /hurryPoll\(\)/.test(bundle),
    roomPagehide: /addEventListener\(`pagehide`,this\.onHide\)/.test(bundle),
    backendIce: /async coopIce\(/.test(bundle),
    meshSlotOrder: /\.slot>\w+\.slot&&this\.link/.test(bundle),
  };
  const compatible = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), bundle: url,
    sha256: createHash('sha256').update(bundle).digest('hex'), checks,
    result: compatible ? 'STATIC_CONTRACT_MATCH' : 'REVIEW_REQUIRED',
    limitation: 'Static source checks do not prove browser injection or real multiplayer recovery.' }, null, 2));
  process.exitCode = compatible ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
