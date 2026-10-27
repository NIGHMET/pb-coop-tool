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
