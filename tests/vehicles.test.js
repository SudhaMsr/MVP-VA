// Vehicles: warn about moving ones, stay quiet about parked ones (first-walk feedback: parked cars kept triggering warnings).
import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import assert from 'node:assert/strict';
import { AlertEngine } from '../docs/js/alerts.js';
import { Tracker } from '../docs/js/tracker.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const W = 640, H = 480, idx = (n) => CLASSES.indexOf(n);
const LEFT = { x1: 20, y1: 230, x2: 160, y2: 330 };    // the kerb side of the picture, outside the walking path
const AHEAD = { x1: 270, y1: 230, x2: 370, y2: 330 };  // straight ahead, in the path
const car = (box, extra = {}) => ({ id: 1, cls: idx('car'), name: 'car', hits: 8, dist: 3, speed: 0, lat: 0, box, ...extra });
const other = (id, lat) => ({ id, cls: idx('person'), name: 'person', hits: 8, dist: 9, speed: 0, lat, box: { x1: 100 + id * 20, y1: 60, x2: 130 + id * 20, y2: 140 } });

test('a parked car at the kerb gets no warning, however close and however long it stays in view', () => {
  const eng = new AlertEngine(CONFIG, 'detailed'); let said = 0;
  for (let t = 0; t <= 60000; t += 500) if (eng.next([car(LEFT, { dist: 2.5 })], W, H, t)) said += 1;
  assert.equal(said, 0);
});

test('a parked car also stays quiet when its distance estimate jitters (closing speed up to the walking pace)', () => {
  const eng = new AlertEngine(CONFIG, 'detailed');
  for (const sp of [-1, 0.5, 1.4, 2.0]) assert.equal(eng.next([car(LEFT, { speed: sp, dist: 4 })], W, H, 0), null, `speed ${sp}`);
});

test('a car approaching fast is still an urgent warning, wherever it is in the picture', () => {
  const a = new AlertEngine().next([car(LEFT, { speed: 5, dist: 9 })], W, H, 0);
  assert.equal(a.priority, 0);
  assert.match(a.text, /Caution\. Car approaching, left/);
});

test('a car crossing the walker’s path is announced as passing ahead', () => {
  const a = new AlertEngine().next([car(AHEAD, { dist: 10, lat: 0.5 })], W, H, 0);
  assert.ok(a, 'should speak');
  assert.equal(a.text, 'Car passing ahead.');
  assert.equal(a.priority, 1);
});

test('a car moving across the picture outside the path is not announced', () => {
  assert.equal(new AlertEngine().next([car(LEFT, { dist: 10, lat: 0.6 })], W, H, 0), null);
});

test('the camera turning is not mistaken for a passing car: everything drifts together', () => {
  // the walker pans the phone; the car and the other things all move sideways at the same rate
  const tracks = [car(AHEAD, { dist: 10, lat: 0.5 }), other(2, 0.5), other(3, 0.48), other(4, 0.52)];
  const a = new AlertEngine().next(tracks, W, H, 0);
  assert.ok(!a || !/passing/.test(a.text), 'no passing alert');
});

test('a very slow drift while walking past is not "passing"', () => {
  assert.equal(new AlertEngine().next([car(AHEAD, { dist: 10, lat: 0.1 })], W, H, 0), null);
});

test('passing needs a few sightings, so a one-frame glitch stays quiet', () => {
  assert.equal(new AlertEngine().next([car(AHEAD, { dist: 10, lat: 0.9, hits: 2 })], W, H, 0), null);
});

test('a still car right in the path and very close is mentioned once (it blocks the way)', () => {
  const eng = new AlertEngine(CONFIG, 'detailed');
  const a = eng.next([car(AHEAD, { dist: 2 })], W, H, 0);
  assert.equal(a.text, 'Car, ahead, about 2 metres. Clearer on the left.');
  assert.equal(a.priority, 2);
  assert.equal(eng.next([car(AHEAD, { dist: 2 })], W, H, 3000), null, 'not repeated');
});

test('a still car in the path further away than the limit stays quiet, and the limit can be switched off', () => {
  assert.equal(new AlertEngine().next([car(AHEAD, { dist: 4 })], W, H, 0), null);
  const off = { ...CONFIG, parkedAheadMetres: 0 };
  assert.equal(new AlertEngine(off, 'detailed').next([car(AHEAD, { dist: 1.5 })], W, H, 0), null);
});

test('the tracker measures sideways speed: still is near zero, crossing is large, a new track has none', () => {
  const tk = new Tracker();
  const det = (x) => ({ cls: idx('car'), name: 'car', score: 0.9, x1: x, y1: 200, x2: x + 100, y2: 300 });
  const first = tk.update([det(100)], 0, W, H)[0];
  assert.equal(first.lat, null);
  let t = 0, x = 100, moving;
  for (let i = 0; i < 6; i++) { t += 100; x += 30; moving = tk.update([det(x)], t, W, H)[0]; } // 300 px/s = 0.47 frame-widths/s
  assert.ok(moving.lat > 0.35 && moving.lat < 0.6, `lat ${moving.lat}`);
  const tk2 = new Tracker(); let still;
  for (let i = 0; i <= 6; i++) still = tk2.update([det(300)], i * 100, W, H)[0];
  assert.ok(Math.abs(still.lat) < 0.02, `still lat ${still.lat}`);
});
