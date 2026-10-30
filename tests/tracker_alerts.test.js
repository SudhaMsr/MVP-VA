import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres'); // these tests check the metres wording; miles is the app default
import assert from 'node:assert/strict';
import { Tracker, estimateDistance } from '../docs/js/tracker.js';
import { AlertEngine, directionOf } from '../docs/js/alerts.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const idx = (n) => CLASSES.indexOf(n);
const det = (name, x1, y1, x2, y2, score = 0.9) => ({ cls: idx(name), name, score, x1, y1, x2, y2 });
const W = 640, H = 480;

test('a brand-new car does not crash and has no speed yet (old prototype crashed here)', () => {
  const tr = new Tracker();
  const tracks = tr.update([det('car', 200, 200, 300, 260)], 0, W);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].speed, null);
  const eng = new AlertEngine();
  assert.doesNotThrow(() => eng.next(tracks, W, H, 0));
});

test('a pole has no distance and does not crash (old prototype crashed here)', () => {
  const tr = new Tracker();
  const tracks = tr.update([det('pole', 300, 50, 320, 450)], 0, W);
  assert.equal(tracks[0].dist, null);
  const eng = new AlertEngine();
  const a = eng.next(tracks, W, H, 0);
  assert.match(a.text, /^Pole, ahead, close/);
});

test('distance shrinks as box grows, and speed turns positive when approaching', () => {
  const tr = new Tracker();
  let last = null;
  for (let i = 0; i < 6; i++) {
    const half = 30 + i * 12; // box widening = approaching
    last = tr.update([det('car', 320 - half, 200, 320 + half, 300)], i * 200, W)[0];
  }
  assert.ok(last.dist < 20);
  assert.ok(last.speed > 0, 'speed should be positive when approaching');
  assert.equal(last.hits, 6);
});

test('estimateDistance is null for classes without a size model and tiny boxes', () => {
  assert.equal(estimateDistance(det('pole', 0, 0, 20, 100), W), null);
  assert.equal(estimateDistance(det('car', 0, 0, 4, 4), W), null);
  const d = estimateDistance(det('person', 300, 100, 364, 400), W); // 64 px wide person
  assert.ok(d > 3 && d < 8, `unexpected ${d}`);
});

test('direction thirds', () => {
  assert.equal(directionOf(50, 640), 'left');
  assert.equal(directionOf(320, 640), 'ahead');
  assert.equal(directionOf(600, 640), 'right');
});

function approachingCarTracks() {
  return [{
    id: 1, cls: idx('car'), name: 'car', hits: 5, dist: 9, speed: 4,
    box: { x1: 400, y1: 200, x2: 520, y2: 300 },
  }];
}

test('approaching car is urgent (priority 0) with direction and distance', () => {
  const eng = new AlertEngine();
  const a = eng.next(approachingCarTracks(), W, H, 1000);
  assert.equal(a.priority, 0);
  assert.equal(a.urgent, true);
  assert.equal(a.text, 'Caution. Car approaching, right, about 9 metres.');
});

test('speed is not trusted until the vehicle has been tracked for a few frames', () => {
  const t = approachingCarTracks();
  t[0].hits = 1;
  t[0].box = { x1: 280, y1: 200, x2: 360, y2: 300 }; // straight ahead, so the routine alert is not filtered as off to the side
  const a = new AlertEngine().next(t, W, H, 0);
  assert.equal(a, null, 'not approaching yet, and not in the way: say nothing');
});

test('cooldown suppresses repeats, then allows again', () => {
  const eng = new AlertEngine();
  assert.ok(eng.next(approachingCarTracks(), W, H, 0));
  assert.equal(eng.next(approachingCarTracks(), W, H, 1000), null);
  assert.ok(eng.next(approachingCarTracks(), W, H, Math.max(CONFIG.cooldownMs[0], CONFIG.urgentGapMs) + 1));
});

test('hazards outrank information, and information is silent while hazards are in view', () => {
  const eng = new AlertEngine();
  const tracks = [
    { id: 1, cls: idx('blind_road'), name: 'blind_road', hits: 3, dist: null, speed: null, box: { x1: 100, y1: 300, x2: 500, y2: 470 } },
    { id: 2, cls: idx('person'), name: 'person', hits: 3, dist: 2.2, speed: 0, box: { x1: 150, y1: 100, x2: 210, y2: 300 } },
  ];
  const a = eng.next(tracks, W, H, 0);
  assert.equal(a.text, 'Person, left, about 2 metres.');
  // person now on cooldown; tactile paving must stay silent while a hazard is in view
  assert.equal(eng.next(tracks, W, H, 500), null);
});

test('far people and signs say nothing', () => {
  const eng = new AlertEngine();
  const tracks = [
    { id: 1, cls: idx('person'), name: 'person', hits: 3, dist: 12, speed: 0, box: { x1: 300, y1: 100, x2: 330, y2: 200 } },
    { id: 2, cls: idx('sign'), name: 'sign', hits: 3, dist: null, speed: null, box: { x1: 10, y1: 10, x2: 80, y2: 80 } },
  ];
  assert.equal(eng.next(tracks, W, H, 0), null);
});

test('very close distance says "very close" not "about 1 metres"', () => {
  const eng = new AlertEngine();
  const t = [{ id: 1, cls: idx('person'), name: 'person', hits: 3, dist: 1.0, speed: 0, box: { x1: 280, y1: 50, x2: 360, y2: 450 } }];
  assert.match(eng.next(t, W, H, 0).text, /^Person, ahead, very close\./);
});

test('model class names from different datasets map to the same alert names', async () => {
  const { canonical } = await import('../docs/js/config.js');
  assert.equal(canonical('Bike'), 'bicycle');
  assert.equal(canonical('Electrical Pole'), 'pole');
  assert.equal(canonical('Dustbin'), 'ashcan');
  assert.equal(canonical('Traffic Cone'), 'reflective_cone');
  assert.equal(canonical('Teraffic Barrel'), 'roadblock');
  assert.equal(canonical('Pedestrian crosswalk'), 'crosswalk');
  assert.equal(canonical('Stairs'), 'stairs');
  assert.equal(canonical('Manhole'), 'manhole');
});

test('stairs are a priority 1 hazard once low in the picture', () => {
  const eng = new AlertEngine();
  const t = [{ id: 1, cls: 4, name: 'stairs', hits: 2, dist: null, speed: null, box: { x1: 200, y1: 250, x2: 440, y2: 440 } }];
  const a = eng.next(t, W, H, 0);
  assert.equal(a.priority, 1);
  assert.equal(a.text, 'Stairs, ahead, close.');
  const far = [{ ...t[0], box: { x1: 200, y1: 120, x2: 440, y2: 180 } }];
  assert.equal(new AlertEngine().next(far, W, H, 0), null);
});

test('manhole only when close; buildings and roads are silent', () => {
  const eng = new AlertEngine();
  const near = [{ id: 1, cls: 11, name: 'manhole', hits: 2, dist: null, speed: null, box: { x1: 250, y1: 380, x2: 400, y2: 470 } }];
  assert.equal(eng.next(near, W, H, 0).text, 'Manhole, ahead, close.');
  const quiet = [
    { id: 2, cls: 1, name: 'building', hits: 2, dist: null, speed: null, box: { x1: 0, y1: 0, x2: 600, y2: 400 } },
    { id: 3, cls: 7, name: 'road', hits: 2, dist: null, speed: null, box: { x1: 0, y1: 300, x2: 640, y2: 480 } },
  ];
  assert.equal(new AlertEngine().next(quiet, W, H, 0), null);
});

test('two-lane merge: slow-lane results are reused briefly, then expire', async () => {
  const { mergeLanes, filterAllowed } = await import('../docs/js/lanes.js');
  const fast = [{ name: 'person' }];
  const slow = { dets: [{ name: 'stairs' }], t: 1000 };
  assert.deepEqual(mergeLanes(fast, slow, 1500, 1500).map((d) => d.name), ['person', 'stairs']);
  assert.deepEqual(mergeLanes(fast, slow, 3000, 1500).map((d) => d.name), ['person']);
  assert.deepEqual(mergeLanes(fast, { dets: [], t: null }, 100, 1500).map((d) => d.name), ['person']);
  const kept = filterAllowed([{ name: 'person' }, { name: 'stairs' }, { name: 'manhole' }], ['stairs', 'manhole']);
  assert.deepEqual(kept.map((d) => d.name), ['stairs', 'manhole']);
});

test('portrait pictures use the long side for the field of view (field log: phone frames are 480x640)', () => {
  const d = estimateDistance(det('person', 190, 100, 290, 500), 480, 66, 640); // 100 px wide, portrait
  assert.ok(Math.abs(d - 0.5 * (640 / (2 * Math.tan((33 * Math.PI) / 180))) / 100) < 1e-9);
  const landscapeStyle = estimateDistance(det('person', 190, 100, 290, 500), 480, 66, 480);
  assert.ok(d > landscapeStyle * 1.3 && d < landscapeStyle * 1.4, 'portrait distance should be about 1.33x larger');
});
