// Optional live landing-page smoke test. No login, joining, or game input.
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  await page.addInitScript({ path: fileURLToPath(new URL('../pb-coop-fix.user.js', import.meta.url)) });
  await page.goto('https://pokebonk.com/?lang=zh', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.__pbCoopFix?.stats.discovery === 'attached', {}, { timeout: 60000 });
  console.log(JSON.stringify(await page.evaluate(() => ({
    result: 'APP_ATTACHED', discovery: window.__pbCoopFix.stats.discovery,
    roomJoined: !!window.__pbCoopFix.stats.room,
    warningCount: window.__pbCoopFix.events.filter(event => event.kind === 'warn').length,
  })), null, 2));
} catch (error) {
  console.error(error.message);
  if (page) console.error(JSON.stringify(await page.evaluate(() => ({ discovery: window.__pbCoopFix?.stats.discovery ?? null })).catch(() => ({}))));
  process.exitCode = 1;
} finally { await browser.close(); }
