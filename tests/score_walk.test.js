// The Stage 1 gate scorer (tools/score_walk.mjs): review sheets from session logs, then pass/fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { template, score, report } from '../tools/score_walk.mjs';

const log = { startedAt: '2026-11-07T10:00:00Z', events: [
  { t: 1000, type: 'battery', detail: '90' },
  { t: 2000, type: 'record-start', detail: 'video/webm' },
  { t: 12000, type: 'alert', detail: '0|Caution. Car approaching, ahead, about 15 steps.' },
  { t: 30000, type: 'alert', detail: '2|Person, ahead, about 4 steps.' },
  { t: 45000, type: 'wrong-alert', detail: 'Person, ahead, about 4 steps.' },
  { t: 122000, type: 'fix', detail: '' },
] };

test('template lists every spoken warning at its time in the video', () => {
  const s = template(log, 'walk1.json');
  assert.equal(s.walk_minutes, 2);
  assert.deepEqual(s.alerts.map((a) => [a.t, a.priority, a.verdict]), [[10, 0, '?'], [28, 2, '?']]);
  assert.deepEqual(s.reported_wrong, ['Person, ahead, about 4 steps.']);
});

test('gate fails while warnings are unreviewed, passes when reviewed and clean', () => {
  const s = template(log);
  assert.equal(score([s]).pass, false);
  s.alerts[0].verdict = 'correct'; s.alerts[0].seen = 8.5; s.alerts[1].verdict = 'correct';
  const r = score([s]);
  assert.equal(r.pass, true, report(r));
  assert.equal(r.vehicleWarnings, 1); assert.equal(r.timeToWarnMedian, 1.5);
});

test('a missed vehicle or too many false warnings fails the gate', () => {
  const s = template(log); s.alerts.forEach((a) => (a.verdict = 'correct'));
  s.missed.push({ t: 50, kind: 'vehicle', note: 'van reversing' });
  assert.match(report(score([s])), /GATE: FAIL - 1 moving vehicles missed/);
  const t = template(log); t.alerts.forEach((a) => (a.verdict = 'false'));
  const r = score([t]);
  assert.equal(r.falsePerMin, 1); assert.equal(r.pass, false);
});
