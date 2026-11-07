#!/usr/bin/env node
// Package D: accessibility audit of the app and its info pages with axe-core in headless Chrome (test-only: nothing here
// ships in docs/). Checks the page as it first opens, with More options and Supervisor tools open, and while running.
// Also checks the rules axe cannot: the two main controls are the biggest, in the lower half of the screen, at least
// 72 x 72 CSS pixels; every other control at least 48 x 48; and the focus order starts Start/Stop, Talk, More options.
// Exit code 1 on any serious or critical problem.
//   npm install, then: npm run check:a11y        (CHROME=/path/to/chrome to use another Chrome)
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { serve } from './lib/serve.mjs';

const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const site = await serve(fileURLToPath(new URL('../docs/', import.meta.url)));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];

async function audit(label) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  for (const v of r.violations) {
    const line = `${label}: [${v.impact}] ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(', ')})`;
    console.log(line);
    if (v.impact === 'serious' || v.impact === 'critical') problems.push(line);
  }
  if (!r.violations.length) console.log(`${label}: no axe violations`);
}

async function layout(label) {
  const r = await page.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const box = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top + scrollY) }; };
    const main = ['startBtn', 'talkBtn'].map((id) => document.getElementById(id)).filter(Boolean).map((e) => ({ id: e.id, ...box(e), area: e.offsetWidth * e.offsetHeight }));
    const others = [...document.querySelectorAll('button, a[href], summary, input, select')].filter((e) => vis(e) && !['startBtn', 'talkBtn'].includes(e.id))
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 30), ...box(e), area: e.offsetWidth * e.offsetHeight }));
    const focus = [...document.querySelectorAll('button, a[href], summary, input, select, [tabindex]')].filter((e) => vis(e) && e.tabIndex >= 0).slice(0, 3)
      .map((e) => e.id || e.textContent.trim());
    return { main, others, focus, vh: innerHeight };
  });
  for (const m of r.main) {
    if (m.w < 72 || m.h < 72) problems.push(`${label}: ${m.id} is ${m.w}x${m.h}, under 72x72`);
    if (m.top + m.h / 2 < r.vh / 2) problems.push(`${label}: ${m.id} is not in the lower half of the screen`);
  }
  if (r.main.length !== 2) problems.push(`${label}: expected the Start/Stop and Talk buttons`);
  const smallestMain = Math.min(...r.main.map((m) => m.area));
  for (const o of r.others) {
    if (o.w < 48 || o.h < 48) problems.push(`${label}: "${o.id}" is ${o.w}x${o.h}, under 48x48`);
    if (o.area >= smallestMain) problems.push(`${label}: "${o.id}" is as big as a main control`);
  }
  if (r.focus.join('|') !== 'startBtn|talkBtn|More options') problems.push(`${label}: focus order starts ${r.focus.join(', ')}`);
  console.log(`${label}: main controls ${r.main.map((m) => `${m.id} ${m.w}x${m.h}`).join(', ')}; focus starts ${r.focus.join(', ')}`);
}

try {
  await page.goto(site.url + '?stt=chrome');
  await audit('Home');
  await layout('Home');
  await page.evaluate(() => { document.getElementById('more').open = true; document.getElementById('sup').open = true; document.getElementById('convo').open = true; });
  await audit('More options open');
  await page.evaluate(() => { document.getElementById('more').open = false; document.getElementById('sup').open = false; document.getElementById('convo').open = false; });
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__va && window.__va.state.running, null, { timeout: 90000 });
  await audit('Running');
  await layout('Running');
  const names = await page.evaluate(() => [document.getElementById('startBtn').getAttribute('aria-label') || document.getElementById('startBtn').textContent, document.getElementById('talkBtn').getAttribute('aria-label') || document.getElementById('talkBtn').textContent]);
  console.log(`Running: names "${names.join('", "')}"`);
  if (!/stop/i.test(names[0])) problems.push('Running: the Start/Stop button is not named for stopping');
  for (const p of ['privacy.html', 'limits.html', 'numbers.html']) { await page.goto(site.url + p); await audit(p); }
} catch (e) {
  problems.push(e.message.split('\n')[0]);
} finally {
  await browser.close(); site.close();
}
console.log(problems.length ? `FAIL:\n  ${problems.join('\n  ')}` : 'PASS: no serious or critical issues; sizes and focus order as required');
process.exit(problems.length ? 1 : 0);
