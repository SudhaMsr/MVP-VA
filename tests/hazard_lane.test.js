// Hazard lane (7 Nov): open-vocabulary YOLOE set to RNIB's obstacle list. Log and on-request only, never spoken as a warning.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HAZARD, canonical } from '../docs/js/config.js';
import { decode } from '../docs/js/detector.js';
import { findObject, objectNames } from '../docs/js/describe.js';

test('config names match the vocabulary the export script uses, in order', () => {
  const vocab = JSON.parse(fs.readFileSync(new URL('../tools/phase4/hazard_vocab.json', import.meta.url))).classes.map((c) => c.name);
  assert.deepEqual(HAZARD.names, vocab);
  assert.equal(HAZARD.speak, false, 'nothing from this lane is spoken as a warning until it passes evaluation');
});

test('decode reads a YOLOE seg output (4 + classes + 32 mask channels) by ignoring the mask channels', () => {
  const nc = HAZARD.names.length, N = 3, C = 4 + nc + 32, out = new Float32Array(C * N);
  const set = (ch, i, v) => { out[ch * N + i] = v; };
  // box 0: an e-scooter at the centre; box 1: below threshold; box 2: high mask coefficient only (must be ignored)
  set(0, 0, 160); set(1, 0, 200); set(2, 0, 60); set(3, 0, 120); set(4 + 0, 0, 0.8);
  set(0, 1, 50); set(1, 1, 50); set(2, 1, 20); set(3, 1, 20); set(4 + 3, 1, 0.1);
  set(0, 2, 250); set(1, 2, 100); set(2, 2, 30); set(3, 2, 30); set(4 + nc + 5, 2, 0.99);
  const d = decode(out, N, { r: 1, dx: 0, dy: 0 }, 320, 320, HAZARD.conf, 0.5, HAZARD.names);
  assert.deepEqual(d.map((x) => x.name), ['e_scooter']);
});

test('"is there an e-scooter?" answers from the hazard lane with a hedge and no distance', () => {
  assert.deepEqual(objectNames('an e-scooter'), ['e_scooter']);
  assert.ok(objectNames('bollard').includes('bollard'));
  const extra = [{ name: 'e_scooter', score: 0.6, x1: 20, y1: 100, x2: 120, y2: 300 }];
  const a = findObject([], 'e-scooter', 480, { extra });
  assert.equal(a, 'I think there is an e-scooter on your left. I am still learning to spot these, so check with your cane.');
  assert.match(findObject([], 'pothole', 480, { extra }), /cannot see a pothole/);
});

test('names survive canonical() except traffic_cone, which joins the existing cone class', () => {
  for (const n of HAZARD.names) if (n !== 'traffic_cone') assert.equal(canonical(n), n);
  assert.equal(canonical('traffic_cone'), 'reflective_cone');
});
