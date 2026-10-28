// Opt-in acceptance using TWO OWNED TEST-ACCOUNT storage states. No credentials
// are bundled, printed, or published. Never point these paths at user profiles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = path.join(root, 'artifacts', 'acceptance');
const states = ['test-a-private-state.json', 'test-b-private-state.json'].map(name => path.join(evidence, name));
if (states.some(file => !fs.existsSync(file))) throw Error('Prepare two owned test accounts through the normal game UI first');
const report = { startedAt: new Date().toISOString(), method: 'Official game and official signalling server; two isolated Chromium contexts on one Windows host',
  limitation: 'One host/network, synthetic transport fault injection; does not prove separate-device/NAT reliability or mobile behavior', steps: [] };
function record(step) { report.steps.push({ time: new Date().toISOString(), ...step }); fs.writeFileSync(path.join(evidence, 'official-game-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(step)); }
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-angle=d3d11'] });
const contexts = [], pages = [], transportErrors = [];
let stage = 'setup';
async function dismissGuides(page) {
  for (let i = 0; i < 4; i++) {
    const button = page.getByRole('button', { name: /^(知道了|跳过)$/ }).first();
    if (!await button.isVisible().catch(() => false)) break;
    await button.click({ timeout: 5000 });
  }
}
async function waitRoom(page, count = 2) {
  await page.waitForFunction(count => window.__pbCoopFix?.stats.room?.alive && __pbCoopFix.stats.room.mesh.members.length === count, count, { timeout: 30000 });
}
async function waitOpen() {
  await Promise.all(pages.map(page => page.waitForFunction(() => {
    const room = window.__pbCoopFix?.stats.room;
    return room?.others.length === 1 && room.others.every(peer => room.mesh.links.get(peer.id)?.state === 'open');
  }, {}, { timeout: 45000 })));
}
async function pair() { return Promise.all(pages.map(page => page.evaluate(() => __pbCoopFix.diagnostics()))); }
try {
  for (const state of states) {
    const context = await browser.newContext({ locale: 'zh-CN', storageState: state }); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on('requestfailed', request => { if (request.url().includes('/coop/')) transportErrors.push({ context: pages.indexOf(page) + 1, endpoint: new URL(request.url()).pathname.replace(/\/rooms\/[A-Z0-9]{4}/g, '/rooms/REDACTED'), failure: request.failure()?.errorText }); }); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
    // These native onboarding overlays may appear after account load; handle
    // their normal UI buttons rather than forcing clicks through them.
    await page.addLocatorHandler(page.locator('.tour').getByRole('button', { name: '跳过', exact: true }), async button => button.click());
    await page.addLocatorHandler(page.getByRole('button', { name: '知道了', exact: true }).first(), async button => button.click());
    await page.addInitScript({ path: path.join(root, 'pb-coop-fix.user.js') });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto('https://pokebonk.com/?lang=zh', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__pbCoopFix?.stats.app?.meta?.account
        || [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '重试'), {}, { timeout: 45000 });
      if (await page.evaluate(() => !!window.__pbCoopFix?.stats.app?.meta?.account)) break;
      if (attempt) throw Error('Official game boot failed twice');
      record({ stage: 'official-page-boot', result: 'RETRIED', context: pages.length, reason: 'Native Retry screen appeared before account load' });
    }
    await dismissGuides(page);
  }
  stage = 'create-official-room';
  await pages[0].getByRole('button', { name: /^合作模式/ }).click();
  await pages[0].getByRole('button', { name: '创建房间', exact: true }).click();
  await waitRoom(pages[0], 1);
  const code = await pages[0].evaluate(() => __pbCoopFix.stats.room.code);
  stage = 'join-official-room';
  await pages[1].getByRole('button', { name: /^合作模式/ }).click();
  const fields = pages[1].locator('.cp-tiles input');
  if (await fields.count() !== code.length) throw Error('Join form changed; inspect UI before continuing');
  for (let i = 0; i < code.length; i++) await fields.nth(i).fill(code[i]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await pages[1].getByRole('button', { name: '加入', exact: true }).click();
    try { await waitRoom(pages[1]); break; }
    catch (error) { if (attempt || !await pages[1].getByRole('button', { name: '加入', exact: true }).isEnabled()) throw error;
      record({stage:'join-official-room',result:'RETRIED',reason:'Native join request timed out; retry normal Join once'}); }
  }
  await waitRoom(pages[0]);
  stage = 'initial-native-connection'; await waitOpen(); record({ stage, result: 'PASS', diagnostics: await pair() });
  for (const action of (process.argv.includes('--gameplay-only') ? [] : ['answerer-failure', 'both-failure', 'deleted-answerer'])) {
    stage = action; const started = Date.now();
    if (action === 'both-failure') {
      await Promise.all(pages.map(page => page.evaluate(() => { const room = __pbCoopFix.stats.room; room.mesh.links.get(room.others[0].id).fail(); })));
    } else {
      await pages[0].evaluate(action => {
        const room = __pbCoopFix.stats.room, id = room.others[0].id, link = room.mesh.links.get(id);
        if (action === 'deleted-answerer') { link.close(); room.mesh.links.delete(id); __pbCoopFix.repairNow(); }
        else link.fail();
      }, action);
    }
    await waitOpen();
    record({ stage, result: 'PASS', recoveryMs: Date.now() - started, diagnostics: await pair() });
  }
  stage = 'room-ui-evidence';
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(evidence, `official-room-${i}.png`) });
  record({ stage, result: 'PASS' });
  async function startGame() {
    const ready = await pages[1].evaluate(() => !!__pbCoopFix.stats.room.mine.ready);
    if (!ready) await pages[1].getByRole('button', { name: /^我准备好了/ }).click();
    await pages[0].getByRole('button', { name: '出发！', exact: true }).last().click();
    await Promise.all(pages.map(page => page.waitForFunction(() => !!window.__pbCoopFix?.stats.app?.run?.coop && __pbCoopFix.stats.room?.inRun, {}, { timeout: 45000 })));
    await Promise.all(pages.map(async page => {
      // Native asset preloader can offer a normal 'start now' button on slow CDN.
      const immediate = page.getByRole('button', { name: '立即开始', exact: true });
      const deadline = Date.now() + 90000;
      while (await page.evaluate(() => document.body.innerText.includes('正在准备区域'))) {
        if (Date.now() > deadline) throw Error('Native game asset preloader did not finish');
        if (await immediate.isVisible().catch(() => false)) await immediate.click({ timeout: 1000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }));
  }
  stage = 'start-real-coop-game'; await startGame(); record({ stage, result: 'PASS', diagnostics: await pair() });
  await Promise.all(pages.map(page => dismissGuides(page)));
  const firstParties = await Promise.all(pages.map(page => page.evaluate(() => __pbCoopFix.stats.app.run.coop.party)));
  async function verifyMovement() {
    await pages[1].waitForFunction(() => { const p = [...__pbCoopFix.stats.app.run.coop.peers.values()][0]; return Number.isFinite(p?.last?.x) && Number.isFinite(p?.last?.z); }, {}, { timeout: 15000 });
    const before = await pages[0].evaluate(() => { const p = __pbCoopFix.stats.app.run.player.pos; return { x: p.x, z: p.z }; });
    const remoteBefore = await pages[1].evaluate(() => { const p = [...__pbCoopFix.stats.app.run.coop.peers.values()][0]; return { at: p.lastAt, x: p.last?.x, z: p.last?.z }; });
    await pages[0].keyboard.down('w'); await new Promise(resolve => setTimeout(resolve, 2500)); await pages[0].keyboard.up('w');
    const movement = await pages[0].evaluate(() => { const p = __pbCoopFix.stats.app.run.player.pos; return { x: p.x, z: p.z }; });
    const distance = Math.hypot(movement.x - before.x, movement.z - before.z);
    if (distance <= 0.1) throw Error('Keyboard input did not produce measurable player movement');
    await pages[1].waitForFunction(before => { const p = [...__pbCoopFix.stats.app.run.coop.peers.values()][0]; return p.lastAt > before.at && Math.hypot(p.last.x - before.x, p.last.z - before.z) > 0.1; }, remoteBefore, { timeout: 15000 });
    return { playerMovedDistance: distance, remoteSnapshotUpdated: true, remotePositionMoved: true };
  }
  stage = 'native-input-and-game-snapshots';
  record({ stage, result: 'PASS', ...await verifyMovement() });
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(evidence, `official-game-${i}.png`) });
  stage = 'return-to-lobby';
  // Native abandon-confirmation handler finishes the run and returns server state
  // to lobby; only then invoke the summary's normal return-room handler.
  await Promise.all(pages.map(page => page.evaluate(async () => { await __pbCoopFix.stats.app.run.finish(false); })));
  await Promise.all(pages.map(page => page.waitForFunction(() => !__pbCoopFix.stats.room.inRun && __pbCoopFix.stats.room.room.state === 'lobby', {}, { timeout: 30000 })));
  await Promise.all(pages.map(page => page.evaluate(() => __pbCoopFix.stats.app.hud.onCoop())));
  await Promise.all(pages.map(page => page.waitForFunction(() => !__pbCoopFix.stats.app.run && !__pbCoopFix.stats.room.inRun, {}, { timeout: 30000 })));
  await waitOpen(); record({ stage, result: 'PASS', diagnostics: await pair() });
  stage = 'second-coop-game'; await startGame();
  const secondParties = await Promise.all(pages.map(page => page.evaluate(() => ({ run: __pbCoopFix.stats.app.run.coop.party, room: __pbCoopFix.stats.room.room.party }))));
  if (!secondParties.every((item, index) => item.run && item.run === item.room && item.run === secondParties[0].run && item.run !== firstParties[index])) throw Error('Second game did not create a consistent new party');
  record({ stage, result: 'PASS', newPartyConfirmed: true, ...await verifyMovement(), diagnostics: await pair() });
} catch (error) {
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(evidence, `official-failure-${i}.png`) }).catch(() => {});
  record({ stage, result: 'FAIL', error: error.message.slice(0, 2600), transportErrors, diagnostics: await pair().catch(() => null),
    visibleButtons: await Promise.all(pages.map(page => page.getByRole('button').allTextContents().catch(() => []))) }); process.exitCode = 1;
} finally {
  // Leave only our own test rooms; do not retain active public rooms on exit.
  for (let i = 0; i < pages.length; i++) {
    await contexts[i].storageState({ path: states[i] }).catch(() => {});
    await pages[i].evaluate(async () => { const room = window.__pbCoopFix?.stats.room; if (room?.alive) await room.leave(); }).catch(() => {});
  }
  await browser.close();
}
