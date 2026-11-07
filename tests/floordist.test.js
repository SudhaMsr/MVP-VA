// Package F: distance from where an object meets the ground, checked against known geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorDistance, angleBelowCentre, pitchFromBeta, parseHeight, cameraHeightM, PitchCalibrator } from '../docs/js/floordist.js';
import { parseCommand } from '../docs/js/commands.js';
import { Dialogue } from '../docs/js/dialogue.js';
import { template, compareDistances } from '../tools/score_walk.mjs';

const H = 640, VFOV = 60;
const rad = (d) => (d * Math.PI) / 180;
// The picture row where a ground point at distance D appears, for a camera at height h tilted down by pitch.
const rowFor = (D, h, pitch) => { const f = (H / 2) / Math.tan(rad(VFOV / 2)); return H / 2 + f * Math.tan(Math.atan(h / D) - rad(pitch)); };

test('known height, pitch and field of view give the known distance', () => {
  for (const [D, h, pitch] of [[3, 1.2, 10], [5, 1.25, 15], [8, 1.3, 5], [2, 1.1, 20], [12, 1.2, 0]]) {
    const y = rowFor(D, h, pitch);
    const got = floorDistance({ yBottom: y, frameH: H, pitchDeg: pitch, camHeightM: h, vfovDeg: VFOV });
    assert.ok(Math.abs(got - D) < 0.01, `${D} m at pitch ${pitch}: got ${got}`);
  }
});

test('the middle row is the camera axis; rows below it look further down', () => {
  assert.equal(angleBelowCentre(H / 2, H, VFOV), 0);
  assert.ok(Math.abs(angleBelowCentre(H, H, VFOV) - 30) < 1e-9, 'the bottom edge is half the field of view down');
  assert.ok(angleBelowCentre(100, H, VFOV) < 0);
  // camera level (pitch 0), 1.2 m up, a point 30 degrees down is 1.2 / tan(30) = 2.08 m away
  const d = floorDistance({ yBottom: H * 0.97, frameH: H, pitchDeg: 0, camHeightM: 1.2, vfovDeg: VFOV, edgeMargin: 0.01 });
  assert.ok(d > 2 && d < 2.3, String(d));
});

test('no estimate when it cannot be trusted', () => {
  const base = { frameH: H, pitchDeg: 10, camHeightM: 1.2, vfovDeg: VFOV };
  assert.equal(floorDistance({ ...base, yBottom: H - 2 }), null, 'the box bottom touches the frame edge');
  assert.equal(floorDistance({ ...base, yBottom: 400, pitchDeg: null }), null, 'pitch missing');
  assert.equal(floorDistance({ ...base, yBottom: 400, camHeightM: 0 }), null, 'height missing');
  assert.equal(floorDistance({ ...base, yBottom: 220 }), null, 'at or above the horizon');
  assert.equal(floorDistance({ ...base, pitchDeg: 0, yBottom: H / 2 + 5 }), null, 'too near the horizon');
});

test('pitch from the phone\'s beta, held upright in portrait', () => {
  assert.equal(pitchFromBeta(90), 0); assert.equal(pitchFromBeta(70), 20); assert.equal(pitchFromBeta(null), null);
  const c = new PitchCalibrator(2000); c.start(0);
  for (let t = 0; t <= 2000; t += 100) c.add(75 + (t % 200 ? 1 : -1), t);
  c.add(10, 2500);
  assert.equal(c.done(), 15, 'average over 2 s; readings after are ignored');
  const none = new PitchCalibrator(); none.start(0); assert.equal(none.done(), null, 'no sensor readings');
});

test('height in feet and inches or centimetres; camera height is 0.72 of it', () => {
  assert.equal(parseHeight('5 foot 8'), 173);
  assert.equal(parseHeight('five feet eight inches'), 173);
  assert.equal(parseHeight("6'"), 183);
  assert.equal(parseHeight('6 foot'), 183);
  assert.equal(parseHeight('172 centimetres'), 172);
  assert.equal(parseHeight('1.65 metres'), 165);
  assert.equal(parseHeight('168'), 168);
  assert.equal(parseHeight('banana'), null);
  assert.equal(parseHeight('5 centimetres'), null, 'not a believable height');
  assert.equal(cameraHeightM(170), 1.22);
});

test('"calibrate" asks the height once through the dialogue', () => {
  assert.equal(parseCommand('calibrate').type, 'calibrate');
  assert.equal(parseCommand('calibrate the distance').type, 'calibrate');
  const said = []; let got = null;
  const d = new Dialogue({ say: (t) => said.push(t), nav: {} });
  d.askValue('How tall are you, in feet and inches or centimetres?', parseHeight, (v) => { got = v; }, 'Say your height.');
  assert.equal(said.at(-1), 'How tall are you, in feet and inches or centimetres?');
  assert.equal(d.answer('purple'), true); assert.equal(said.at(-1), 'Say your height.'); assert.equal(got, null);
  assert.equal(d.answer('5 foot 8'), true); assert.equal(got, 173); assert.equal(d.waiting, false);
});

test('scorer: both estimates go into the sheet, and compare reports each method\'s error', () => {
  const log = { events: [
    { t: 0, type: 'record-start', detail: '' },
    { t: 10000, type: 'alert', detail: '2|Pole, ahead, close.' },
    { t: 10005, type: 'alert-dist', detail: JSON.stringify({ text: 'Pole, ahead, close.', box: null, floor: 2.4 }) },
    { t: 20000, type: 'alert', detail: '2|Person, ahead, about 4 steps.' },
    { t: 20004, type: 'alert-dist', detail: JSON.stringify({ text: 'Person, ahead, about 4 steps.', box: 3.1, floor: 2.6 }) },
  ] };
  const s = template(log);
  assert.deepEqual(s.alerts.map((a) => [a.box_m, a.floor_m]), [[null, 2.4], [3.1, 2.6]]);
  s.alerts[0].true_m = 2.0; s.alerts[1].true_m = 2.5;
  const more = { alerts: [{ box_m: 6, floor_m: 4.4, true_m: 4 }, { box_m: 1.5, floor_m: 1.2, true_m: 1.0 }] };
  const c = compareDistances([s, more]);
  assert.deepEqual(c.box, { n: 3, median: 0.6, p90: 2 });
  assert.deepEqual(c.floor, { n: 4, median: 0.2, p90: 0.4 });
  assert.equal(c.better, 'floor');
  assert.equal(compareDistances([{ alerts: [] }]).better, null);
});
