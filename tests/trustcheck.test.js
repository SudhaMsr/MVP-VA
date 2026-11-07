// Trust features (7 Nov): "why did you say that?", "are you working?", and a start-up check that is silent when all is well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explainAlert, selfCheckText } from '../docs/js/trustcheck.js';
import { parseCommand } from '../docs/js/commands.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { CONFIG } from '../docs/js/config.js';
import { setUnits } from '../docs/js/units.js';

test('the new questions are understood, and old ones still are', () => {
  for (const q of ['why did you say that', 'why', 'why did you warn me', 'explain that', 'why that warning']) assert.equal(parseCommand(q).type, 'why', q);
  for (const q of ['are you working', 'is everything working', 'self check']) assert.equal(parseCommand(q).type, 'selfcheck', q);
  assert.equal(parseCommand('what did you say').type, 'repeat');
  assert.equal(parseCommand('that was wrong').type, 'wrong');
  assert.equal(parseCommand('stop').type, 'stop');
});

test('a real vehicle alert from the engine is explained with what was seen', () => {
  setUnits('steps');
  const e = new AlertEngine(CONFIG, 'quiet');
  const W = 480, H = 640;
  const car = { id: 1, name: 'car', cls: 2, score: 0.88, hits: 12, dist: 12, speed: 9, speedN: 8, lat: 0, box: { x1: 180, y1: 300, x2: 300, y2: 380 } };
  const a = e.next([car], W, H, 1000);
  assert.ok(a && a.urgent, JSON.stringify(a));
  const why = explainAlert(a);
  assert.match(why, /I saw a car straight ahead, about \d+ steps, coming towards you at about 20 miles an hour/);
  assert.match(why, /fairly sure/);
});

test('crowd, stop and unsure cases are explained honestly', () => {
  assert.match(explainAlert({ key: 'crowd', crowd: true, count: 4, d: 3, text: 'Busy ahead, people close.' }), /4 people close together.*did not say stop/);
  assert.match(explainAlert({ key: 'person:ahead', name: 'person', dir: 'ahead', d: 1, priority: 2, inPath: true, score: 0.5, text: 'Person, ahead, very close. No clear way. Stop.' }), /Both sides looked blocked.*not very sure/);
  assert.equal(explainAlert(null), 'I have not given a warning yet.');
});

test('self check: silent when all is well on a normal start, full when asked, problems always said', () => {
  const ok = { camera: true, location: true, internet: true, listening: true, battery: 0.8 };
  assert.equal(selfCheckText(ok), '');
  assert.match(selfCheckText(ok, true), /all working/);
  const bad = selfCheckText({ ...ok, location: false, internet: false, battery: 0.1 });
  assert.match(bad, /location is off/i); assert.match(bad, /no internet.*warnings still do/); assert.match(bad, /10 percent/);
  assert.match(selfCheckText({ ...ok, listening: false }), /phone's own listening/);
});
