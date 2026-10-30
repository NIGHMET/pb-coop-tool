import { test, expect } from '@playwright/test';
import path from 'node:path';

test('real browser discovers a module App and removes its UI and wrappers on disposal', async ({ page }) => {
  await page.addInitScript({ content: 'window.beforePC = RTCPeerConnection; window.beforeFetch = fetch;' });
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') });
  await page.goto('/coop/TEST');
  await expect.poll(() => page.evaluate(() => __pbCoopFix.stats.discovery)).toBe('attached');
  await expect(page.locator('.pbf')).toBeVisible();
  const result = await page.evaluate(() => {
    const api = __pbCoopFix; api.dispose();
    return { api: !!window.__pbCoopFix, pcRestored: RTCPeerConnection === window.beforePC, fetchRestored: fetch === window.beforeFetch, panels: document.querySelectorAll('.pbf').length };
  });
  expect(result).toEqual({ api: false, pcRestored: true, fetchRestored: true, panels: 0 });
});

test('wrapped native WebRTC connections still exchange real data', async ({ page }) => {
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') });
  await page.goto('/coop/TEST');
  const message = await page.evaluate(async () => {
    const a = new RTCPeerConnection({ iceServers: [] }), b = new RTCPeerConnection({ iceServers: [] });
    a.onicecandidate = e => { if (e.candidate) void b.addIceCandidate(e.candidate); };
    b.onicecandidate = e => { if (e.candidate) void a.addIceCandidate(e.candidate); };
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Native data channel timed out')), 10000);
      b.ondatachannel = event => { event.channel.onmessage = e => { clearTimeout(timeout); resolve(e.data); }; };
    });
    const channel = a.createDataChannel('check'); channel.onopen = () => channel.send('native-webrtc-ok');
    try {
      await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
      return await received;
    } finally { a.close(); b.close(); }
  });
  expect(message).toBe('native-webrtc-ok');
});

test('an answering peer recovers with only one side installed and no remote retry budget', async ({ context, page }) => {
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') });
  const remote = await context.newPage();
  await page.goto('/coop/TEST'); await remote.goto('/coop/TEST');
  await page.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(0); });
  await remote.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(1); });
  await expect.poll(() => page.evaluate(() => nativeRoom.mesh.state('right'))).toBe('open');
  await expect.poll(() => page.evaluate(() => __pbCoopFix.stats.room === nativeRoom)).toBe(true);
  await page.evaluate(() => {
    const link = nativeRoom.mesh.links.get('right'); link.pc.close(); link.state = 'failed'; __pbCoopFix.repairNow();
  });
  await expect.poll(() => page.evaluate(() => nativeRoom.mesh.state('right')), { timeout: 12000 }).toBe('open');
  await remote.evaluate(() => nativeRoom.mesh.links.get('left').ctl.send('recovered-native-data'));
  await expect.poll(() => page.evaluate(() => nativeRoom.calls.messages)).toContain('recovered-native-data');
  expect(await page.evaluate(() => nativeRoom.calls.resets)).toBe(1);
  expect(await page.evaluate(() => nativeRoom.calls.leaves)).toBe(0);
  expect(await remote.evaluate(() => !!window.__pbCoopFix)).toBe(false);
});

test('a deleted answering-side link is restored and exchanges native data', async ({ context, page }) => {
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') });
  const remote = await context.newPage();
  await page.goto('/coop/TEST'); await remote.goto('/coop/TEST');
  await page.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(0); });
  await remote.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(1); });
  await expect.poll(() => page.evaluate(() => nativeRoom.mesh.state('right'))).toBe('open');
  await expect.poll(() => page.evaluate(() => __pbCoopFix.stats.room === nativeRoom)).toBe(true);
  await page.evaluate(() => {
    nativeRoom.mesh.links.get('right').close(); nativeRoom.mesh.links.delete('right');
    window.reportBeforeRepair = __pbCoopFix.diagnostics(); __pbCoopFix.repairNow();
  });
  expect(await page.evaluate(() => reportBeforeRepair.peers[0].state)).toBe('missing');
  await expect.poll(() => page.evaluate(() => nativeRoom.mesh.state('right')), { timeout: 12000 }).toBe('open');
  await remote.evaluate(() => nativeRoom.mesh.links.get('left').ctl.send('missing-link-restored'));
  await expect.poll(() => page.evaluate(() => nativeRoom.calls.messages)).toContain('missing-link-restored');
  const report = await page.evaluate(() => __pbCoopFix.diagnostics());
  expect(report.peers[0].iceState).toMatch(/connected|completed/);
  expect(report.peers[0].hasRemoteDescription).toBe(true);
});

test('stale answers are discarded before WebRTC and the current answer restores real data', async ({ context, page }) => {
  const remote = await context.newPage();
  for (const p of [page, remote]) { await p.addInitScript({ path: path.resolve('pb-coop-fix.user.js') }); await p.goto('/coop/TEST'); }
  await page.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(0); });
  await remote.evaluate(async () => { window.nativeRoom = (await import('/native-room.mjs')).createRoom(1); });
  for (const [p, peer] of [[page, 'right'], [remote, 'left']]) {
    await expect.poll(() => p.evaluate(peer => nativeRoom.mesh.state(peer) === 'open' && __pbCoopFix.stats.room === nativeRoom, peer)).toBe(true);
    await p.evaluate(() => { __pbCoopFix.cfg.autoRepair = false; });
  }
  await page.evaluate(() => {
    const original = BroadcastChannel.prototype.postMessage;
    window.heldAnswers = [];
    BroadcastChannel.prototype.postMessage = function (message) {
      if (message.kind === 'answer') heldAnswers.push({ channel: this, message }); else original.call(this, message);
    };
    window.releaseAnswer = index => original.call(heldAnswers[index].channel, heldAnswers[index].message);
    nativeRoom.mesh.links.get('right').state = 'failed'; __pbCoopFix.repairNow();
  });
  await expect.poll(() => page.evaluate(() => heldAnswers.length)).toBe(1);
  await remote.evaluate(() => { nativeRoom.mesh.links.get('left').state = 'failed'; __pbCoopFix.repairNow(); });
  await expect.poll(() => page.evaluate(() => heldAnswers.length)).toBe(2);
  await page.evaluate(() => releaseAnswer(0));
  await expect.poll(() => remote.evaluate(() => __pbCoopFix.stats.staleSignalsDropped)).toBe(1);
  expect(await remote.evaluate(() => nativeRoom.mesh.links.get('left').pc.remoteDescription)).toBe(null);
  await page.evaluate(() => releaseAnswer(1));
  await expect.poll(() => remote.evaluate(() => nativeRoom.mesh.state('left'))).toBe('open');
  await remote.evaluate(() => nativeRoom.mesh.links.get('left').ctl.send('current-generation-ok'));
  await expect.poll(() => page.evaluate(() => nativeRoom.calls.messages)).toContain('current-generation-ok');
});

test('the default panel does not block a lobby action at the bottom right', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') }); await page.goto('/coop/TEST');
  await page.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Ready probe';
    button.style.cssText = 'position:fixed;right:16px;bottom:16px;width:180px;height:48px';
    button.onclick = () => { window.readyClicked = true; }; document.body.append(button);
  });
  await expect(page.locator('.pbf')).toBeVisible();
  await page.getByRole('button', { name: 'Ready probe', exact: true }).click({ timeout: 1500 });
  expect(await page.evaluate(() => window.readyClicked)).toBe(true);
});

test('a legacy hidden panel can be restored after reload without changing network settings', async ({ page }) => {
  await page.goto('/coop/TEST');
  await page.evaluate(() => localStorage.setItem('pbCoopFix.cfg', JSON.stringify({ panel: 'hide', autoRepair: false, dropIPv6: true })));
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') }); await page.reload();
  const restore = page.getByRole('button', { name: '显示联机增强面板', exact: true });
  await expect(restore).toBeVisible(); await expect(page.locator('.pbf')).toBeHidden();
  await restore.click(); await expect(page.locator('.pbf')).toBeVisible(); await expect(restore).toBeHidden();
  expect(await page.evaluate(() => ({ autoRepair: __pbCoopFix.cfg.autoRepair, dropIPv6: __pbCoopFix.cfg.dropIPv6 }))).toEqual({ autoRepair: false, dropIPv6: true });
  await page.getByTitle('收起到联机增强按钮').click(); await page.reload(); await expect(restore).toBeVisible();
  await restore.click(); await expect(page.locator('.pbf')).toBeVisible();
  await page.evaluate(() => __pbCoopFix.dispose()); await expect(page.locator('.pbf, .pbf-launcher')).toHaveCount(0);
});

test('a stored offscreen panel and a later viewport shrink remain fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/coop/TEST');
  await page.evaluate(() => localStorage.setItem('pbCoopFix.cfg', JSON.stringify({ panelPos: { left: 2100, top: 1300 } })));
  await page.addInitScript({ path: path.resolve('pb-coop-fix.user.js') }); await page.reload();
  await expect(page.locator('.pbf')).toBeVisible();
  const fits = () => page.locator('.pbf').evaluate(node => {
    const r = node.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  await expect.poll(fits).toBe(true);
  await page.setViewportSize({ width: 760, height: 560 }); await expect.poll(fits).toBe(true);
});
