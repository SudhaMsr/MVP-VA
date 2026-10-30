// A blocked camera must never be silent: silence sounds like "all clear" to a blind walker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameStats, looksBlocked, CameraWatch } from '../docs/js/camcheck.js';

const flat = (v) => new Uint8Array(768).fill(v);
const street = () => Uint8Array.from({ length: 768 }, (_, i) => (i * 37) % 200 + 30); // lots of detail

test('frame stats and the blocked test: dark, covered, and an ordinary street', () => {
  assert.equal(looksBlocked(frameStats(flat(5))), 'dark');
  assert.equal(looksBlocked(frameStats(flat(120))), 'covered', 'a finger over the lens: bright enough but no detail');
  assert.equal(looksBlocked(frameStats(street())), null);
});

test('says it once after 3 s, reminds every 30 s, and says when it can see again', () => {
  const said = []; const w = new CameraWatch({ say: (t) => said.push(t) });
  for (let t = 0; t < 2900; t += 1000) w.update(frameStats(flat(3)), t);
  assert.equal(said.length, 0, 'not for a dark doorway or a hand wave');
  w.update(frameStats(flat(3)), 3000);
  assert.deepEqual(said, ["I can't see clearly. It is too dark for the camera."]);
  for (let t = 4000; t < 33000; t += 1000) w.update(frameStats(flat(3)), t);
  assert.equal(said.length, 1, 'no repeat inside 30 s');
  w.update(frameStats(flat(3)), 33000);
  assert.equal(said.length, 2, 'a reminder after 30 s');
  w.update(frameStats(street()), 34000);
  assert.equal(said.at(-1), 'I can see again.');
  w.update(frameStats(street()), 35000);
  assert.equal(said.length, 3, '"see again" only once');
});

test('a short blocked moment says nothing, and nothing about clear when it was never reported', () => {
  const said = []; const w = new CameraWatch({ say: (t) => said.push(t) });
  w.update(frameStats(flat(120)), 0); w.update(frameStats(flat(120)), 1500);
  w.update(frameStats(street()), 2000);
  assert.equal(said.length, 0);
});

test('covered camera has its own wording', () => {
  const said = []; const w = new CameraWatch({ say: (t) => said.push(t) });
  w.update(frameStats(flat(150)), 0); w.update(frameStats(flat(150)), 3500);
  assert.match(said[0], /covering the camera/);
});
