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
  const a = new AlertEngine().next([car(LEFT, { speed: 8, dist: 9 })], W, H, 0);
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

test('a parked car in the path is mentioned at about 5 m, as parked, with the clearer side', () => {
  const a = new AlertEngine(CONFIG, 'quiet').next([car(AHEAD, { dist: 4 })], W, H, 0);
  assert.match(a.text, /^Parked car ahead, about 4 metres\./);
  assert.equal(a.urgent, false);
  assert.equal(new AlertEngine(CONFIG, 'quiet').next([car(AHEAD, { dist: 6 })], W, H, 0), null, 'further than 5 m: not yet');
});

test('said once: not again as the walker gets closer, and no 30 s reminder', () => {
  const eng = new AlertEngine(CONFIG, 'quiet'); let said = 0;
  for (let t = 0, d = 4.8; t <= 60000; t += 1000, d = Math.max(0.8, d - 0.2)) if (eng.next([car(AHEAD, { dist: d })], W, H, t)) said += 1;
  assert.equal(said, 1);
});

test('no way round on the pavement: warn that the walker may have to step into the road', () => {
  const wide = { x1: 10, y1: 200, x2: 630, y2: 470 };
  const a = new AlertEngine(CONFIG, 'quiet').next([car(wide, { dist: 2 })], W, H, 0);
  assert.match(a.text, /^Parked car ahead, about 2 metres\. It is blocking the path\. Take care if you step into the road\.$/);
});

test('a parked car at the kerb, out of the path, stays silent; the rule can be switched off', () => {
  assert.equal(new AlertEngine(CONFIG, 'detailed').next([car(LEFT, { dist: 2 })], W, H, 0), null);
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

test('speeding rule from the first Vision Assist: car over 7 m/s, bus and truck over 5 m/s, within 20 m', () => {
  const v = (name, speed, dist = 10) => [{ ...car(LEFT, { speed, dist }), name, cls: idx(name) }];
  const urgent = (t) => { const a = new AlertEngine(CONFIG, 'quiet').next(t, W, H, 0); return !!(a && a.priority === 0); };
  assert.equal(urgent(v('car', 5)), false, 'a car at 5 m/s, 10 m away, is not speeding');
  assert.equal(urgent(v('car', 8)), true);
  assert.equal(urgent(v('bus', 4)), false);
  assert.equal(urgent(v('bus', 6)), true);
  assert.equal(urgent(v('truck', 6)), true);
  assert.equal(urgent(v('car', 12, 25)), false, 'further than 20 m: not yet');
  assert.equal(urgent(v('bicycle', 3, 5)), true, 'bicycles keep the lower threshold: they share the pavement');
});

test('very close, a slow vehicle still gets the warning: reversing or pulling out', () => {
  const v = (speed, dist) => [{ ...car(LEFT, { speed, dist }) }];
  const urgent = (t) => { const a = new AlertEngine(CONFIG, 'quiet').next(t, W, H, 0); return !!(a && a.priority === 0); };
  assert.equal(urgent(v(3, 4)), true, 'a car 4 m away closing at 3 m/s');
  assert.equal(urgent(v(3, 8)), false, 'the same speed 8 m away: not yet');
  assert.equal(urgent(v(1.4, 3)), false, 'walking towards a parked car at walking pace: quiet');
});

test('a vehicle seen in only a few frames is not called parked (likely a misdetection)', () => {
  assert.equal(new AlertEngine(CONFIG, 'quiet').next([car(AHEAD, { dist: 3, hits: 3 })], W, H, 0), null);
});
