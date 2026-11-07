// Busy pavements (7 Nov): one calm "Busy ahead" instead of a "Stop" per person, and someone very close straight ahead
// is always spoken, even when the talk budget is used up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../docs/js/alerts.js';
import { CONFIG } from '../docs/js/config.js';
import { setUnits } from '../docs/js/units.js';

const W = 480, H = 640;
const person = (id, cx, d) => {
  const h = Math.min(H * 0.9, 1100 / d), w = h * 0.4;
  return { id, name: 'person', cls: 0, score: 0.9, hits: 10, dist: d, speed: 0, speedN: 6,
    box: { x1: cx - w / 2, y1: H * 0.95 - h, x2: cx + w / 2, y2: H * 0.95 } };
};
const run = (engine, frames, t0 = 1000) => {
  const said = [];
  frames.forEach((tracks, i) => { const a = engine.next(tracks, W, H, t0 + i * 100); if (a) said.push(a.text); });
  return said;
};

test('a crowd close ahead is said once, calmly, without "Stop"', () => {
  setUnits('steps');
  const e = new AlertEngine(CONFIG, 'normal');
  const crowd = [person(1, 200, 3), person(2, 260, 3.5), person(3, 300, 2.5)];
  const said = run(e, Array.from({ length: 100 }, () => crowd)); // 10 s of the same busy pavement
  const busy = said.filter((t) => t.startsWith('Busy ahead'));
  assert.equal(busy.length, 1, `said: ${JSON.stringify(said)}`);
  assert.ok(!said.some((t) => /Stop/.test(t)), `no Stop for a crowd that is not right in front: ${JSON.stringify(said)}`);
  assert.ok(!said.some((t) => t.startsWith('Person,')), 'people in the crowd are not named one by one');
});

test('someone very close straight ahead in a crowd still gets the real warning', () => {
  const e = new AlertEngine(CONFIG, 'normal');
  const frames = Array.from({ length: 30 }, () => [person(1, 240, 1.0), person(2, 180, 3), person(3, 300, 3.5)]);
  const said = run(e, frames);
  assert.ok(said.some((t) => t.startsWith('Person, ahead, very close')), JSON.stringify(said));
});

test('very close straight ahead is spoken even when the per-minute budget is used up', () => {
  const e = new AlertEngine(CONFIG, 'quiet');
  e.spokenMin = Array.from({ length: 10 }, (_, i) => 500 + i); // budget already spent this minute
  e.spokenAt = [900, 950, 990];
  const said = run(e, Array.from({ length: 10 }, () => [person(1, 240, 1.0)]));
  assert.ok(said.some((t) => t.startsWith('Person, ahead, very close')), JSON.stringify(said));
});

test('two people are not a crowd: the old wording is unchanged', () => {
  const e = new AlertEngine(CONFIG, 'normal');
  const said = run(e, Array.from({ length: 20 }, () => [person(1, 240, 3)]));
  assert.ok(said[0].startsWith('Person, ahead'), JSON.stringify(said));
});

test('crowdMin 0 turns the crowd rule off', () => {
  const e = new AlertEngine({ ...CONFIG, crowdMin: 0 }, 'normal');
  const said = run(e, Array.from({ length: 20 }, () => [person(1, 200, 3), person(2, 260, 3.5), person(3, 300, 2.5)]));
  assert.ok(!said.some((t) => t.startsWith('Busy ahead')), JSON.stringify(said));
});
