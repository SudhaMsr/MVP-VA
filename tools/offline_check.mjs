#!/usr/bin/env node
// Package B check: is the app installable, and does it start detection with no signal?
// Loads docs/ in headless Chrome with a fake camera, starts once online (fills the caches), then goes offline, reloads,
// starts again and checks that detection runs and the no-internet line is spoken.
// Needs the dev dependencies: npm install, then npx playwright install chromium (or CHROME=/path/to/chrome).
//   node tools/offline_check.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const site = await serve(docs);
// A real profile (not incognito): Chrome never offers to install from an incognito window. Kept on disk, not in /tmp:
// where /tmp is a RAM disk (WSL), Chrome refuses Cache Storage entries over about 10 MB, so the models would never cache.
const cacheDir = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
fs.mkdirSync(cacheDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(cacheDir, 'va-offline-'));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME || undefined, permissions: ['camera', 'microphone'],
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const browser = { close: async () => { await ctx.close(); fs.rmSync(profile, { recursive: true, force: true }); } };
const page = ctx.pages()[0] || await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

const startAndWait = async () => {
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__va && window.__va.state.running, null, { timeout: 90000 });
  await page.waitForFunction(() => document.getElementById('stats').textContent.includes('frames/s'), null, { timeout: 30000 });
};

try {
  await page.goto(site.url + '?stt=chrome');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const { url: manifestUrl } = await cdp.send('Page.getAppManifest');
  console.log(`Manifest: ${manifestUrl || 'none'}`);
  console.log(`Installable: ${installabilityErrors.length ? 'NO - ' + installabilityErrors.map((e) => e.errorId).join(', ') : 'yes'}`);
  if (installabilityErrors.length) problems.push('not installable');

  await startAndWait();
  console.log('Online start: detection running');
  await page.click('#startBtn'); // Start walking / Stop walking
  await page.waitForTimeout(500);

  console.log('Models kept on the phone:', JSON.stringify(await page.evaluate(async () => (await (await caches.open('va-models-v1')).keys()).map((r) => r.url.replace(location.origin, '')))));
  await ctx.setOffline(true);
  // Playwright cuts the network but does not always set navigator.onLine to false, so the page is told directly.
  await page.addInitScript(() => { window.__offline = true; Object.defineProperty(Navigator.prototype, 'onLine', { get: () => !window.__offline, configurable: true }); });
  await page.reload();
  await page.waitForSelector('#startBtn');
  console.log(`Offline reload: page shown, version ${await page.textContent('#ver')}`);
  await startAndWait();
  const said = await page.evaluate(() => window.__va.session.events.filter((e) => e.type === 'online').map((e) => e.detail));
  console.log(`Offline start: detection running (navigator.onLine is ${await page.evaluate(() => navigator.onLine)})`);
  if (!said.some((t) => t.startsWith('No internet.'))) problems.push('the no-internet line was not spoken');
  else console.log('Spoken: "No internet. I can still spot obstacles, but directions and Google listening need signal."');
  await ctx.setOffline(false);
  await page.evaluate(() => { window.__offline = false; window.dispatchEvent(new Event('online')); });
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => window.__va.session.events.some((e) => e.type === 'online' && e.detail === 'Internet is back.'));
  if (!back) problems.push('"Internet is back." was not spoken'); else console.log('Spoken: "Internet is back."');
} catch (e) {
  problems.push(e.message.split('\n')[0]);
  try { console.log('Status:', await page.textContent('#status'), JSON.stringify(await page.evaluate(() => window.__va && window.__va.session.events.filter((e) => /model|error/.test(e.type) && e.type !== 'mic-error').slice(-6)))); } catch (_) { /* page gone */ }
} finally {
  await browser.close(); site.close();
}
console.log(problems.length ? `FAIL: ${problems.join('; ')}` : 'PASS: installable, and starts detection with no signal');
process.exit(problems.length ? 1 : 0);
