// Package C: walk measurements, slow-phone mode, walk summary, and the numbers page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PerfMeter, SlowMode, WalkStats, summaryText, SLOW_TEXT } from '../docs/js/perf.js';
import { parseCommand } from '../docs/js/commands.js';
import { isSafeText } from '../docs/js/safetext.js';
import { template, score, report, perfFromLog, numbersPage } from '../tools/score_walk.mjs';

test('perf meter: main-lane fps and average ms per lane over the period, then starts again', () => {
  const m = new PerfMeter(); m.reset(0);
  for (let i = 0; i < 240; i++) { m.frame(); m.lane('main', 100); }
  m.lane('rod2', 400); m.lane('rod2', 500); m.lane('coco', 300); m.lane('nonsense', 5);
  assert.deepEqual(m.snapshot(30000), { fps: 8, ms: { main: 100, rod2: 450, coco: 300, hazard: null }, secs: 30 });
  assert.deepEqual(m.snapshot(60000).ms, { main: null, rod2: null, coco: null, hazard: null }, 'counters reset');
});

test('slow-phone mode: under 4 fps for 20 s turns on, over 6 fps for 30 s turns off', () => {
  const s = new SlowMode(); let t = 0; const changes = [];
  const run = (fps, secs) => { for (let i = 0; i < secs; i++) { const c = s.update(fps, t); if (c) changes.push([c, t / 1000]); t += 1000; } };
  run(3, 19); assert.equal(s.slow, false, '19 s is not enough');
  run(5, 1); run(3, 19); assert.equal(s.slow, false, 'one good second starts the count again');
  run(3, 2); assert.equal(s.slow, true);
  assert.equal(s.every(2000), 4000, 'rod2 and coco intervals double');
  assert.equal(s.every(4000, true), Infinity, 'the hazard lane is skipped');
  run(7, 29); assert.equal(s.slow, true, '29 s fast is not enough');
  run(5, 1); run(7, 31); assert.equal(s.slow, false);
  assert.equal(s.every(2000), 2000);
  assert.deepEqual(changes.map((c) => c[0]), ['slow', 'normal']);
});

test('slow-phone mode speaks once per walk, and never touches the main lane', () => {
  const s = new SlowMode();
  assert.equal(s.announce(), SLOW_TEXT); assert.equal(s.announce(), '');
  s.reset(); assert.equal(s.announce(), SLOW_TEXT);
  assert.equal(SLOW_TEXT, 'The phone is running slowly, so I am checking less often.');
  const app = fs.readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /detector\.detect\([^)]*\)[^;]*slowMode/, 'the main detector call is never gated by slow mode');
  assert.doesNotMatch(app, /minFrameGapMs[^;\n]*slowMode/);
});

test('walk summary: duration, warnings, vehicles, fps and battery', () => {
  const w = new WalkStats();
  assert.equal(w.summary(0), null);
  assert.match(summaryText(null), /No walk yet/);
  w.start(0, 0.9);
  w.alert('Caution. Car approaching, ahead, about 10 steps.', 0); w.alert('Parked van ahead, about 4 steps.', 1); w.alert('Person, ahead, very close.', 2);
  w.perf(8, 0.88); w.perf(6, 0.86);
  w.stop(12 * 60000, 0.85);
  assert.deepEqual(w.summary(), { minutes: 12, alerts: 3, vehicles: 2, fps: 7, batteryUsed: 5 });
  assert.equal(summaryText(w.summary()), 'Walk summary. 12 minutes. 3 warnings spoken, 2 about vehicles. About 7 checks a second. Battery used: 5 percent.');
  const c = new WalkStats(); c.start(0, 0.5); c.perf(8, 0.6, true); c.stop(60000, 0.6);
  assert.equal(c.summary().batteryUsed, null, 'charging during the walk: battery use unknown');
  assert.match(summaryText(c.summary()), /Battery use not known/);
  for (const q of ['walk summary', 'how was my walk']) assert.equal(parseCommand(q).type, 'walkSummary', q);
  assert.ok(isSafeText(summaryText(w.summary())));
});

const perfEv = (t, fps, battery, extra = {}) => ({ t, type: 'perf', detail: JSON.stringify({ fps, ms: { main: 110, rod2: 430, coco: null, hazard: null }, battery, charging: false, ...extra }) });
const log = { startedAt: '2026-11-07T10:00:00Z', events: [
  { t: 0, type: 'record-start', detail: 'video/webm' },
  perfEv(30000, 8, 0.90), perfEv(60000, 6, 0.89),
  { t: 70000, type: 'alert', detail: '0|Caution. Car approaching, ahead, about 15 steps.' },
  { t: 80000, type: 'slow-mode', detail: 'on' },
  perfEv(1830000, 7, 0.80),
  { t: 1831000, type: 'walk-summary', detail: JSON.stringify({ minutes: 30.5, alerts: 1, vehicles: 1, fps: 7, batteryUsed: 10 }) },
] };

test('scorer reads speed and battery from the perf events', () => {
  const p = perfFromLog(log);
  assert.equal(p.samples, 3); assert.equal(p.fps, 7); assert.equal(p.minFps, 6);
  assert.deepEqual(p.laneMs, { main: 110, rod2: 430 });
  assert.equal(p.batteryPerHour, 20, '10 percent over 30 minutes');
  assert.equal(p.slowMode, true); assert.equal(p.walks[0].alerts, 1);
  const s = template(log); s.alerts[0].verdict = 'correct';
  const r = score([s]);
  assert.equal(r.fps, 7); assert.equal(r.batteryPerHour, 20); assert.equal(r.slowModeWalks, 1);
  assert.match(report(r), /Speed: 7 frames per second on average \(slow-phone mode on 1 walk\(s\)\)/);
  assert.match(report(r), /Battery: 20 percent per hour/);
  assert.equal(perfFromLog({ events: [] }).batteryPerHour, null);
});

test('numbers page: not measured, then the measured figures with the date; a failed gate says so', () => {
  const empty = numbersPage(null, '2026-11-07');
  assert.match(empty, /Not measured yet/); assert.match(empty, /0 missed moving vehicles/);
  assert.equal(fs.readFileSync(new URL('../docs/numbers.html', import.meta.url), 'utf8'), empty, 'docs/numbers.html is the generated page (run: node tools/score_walk.mjs numbers)');
  const s = template(log); s.alerts[0].verdict = 'correct';
  const page = numbersPage(score([s]), '2026-11-20');
  for (const want of ['Walks scored</th><td>1', 'Moving vehicles missed</th><td>0', 'False warnings per minute</th><td>0', 'Average checks per second</th><td>7',
    'Battery used per hour</th><td>20 percent', '2026-11-20', 'Stage 1 gate passed.']) assert.ok(page.includes(want), want);
  s.missed.push({ t: 10, kind: 'vehicle' });
  const bad = numbersPage(score([s]), '2026-11-20');
  assert.match(bad, /Stage 1 gate not passed yet/); assert.match(bad, /1 moving vehicles missed/);
  assert.ok(isSafeText(bad) && isSafeText(page));
});
