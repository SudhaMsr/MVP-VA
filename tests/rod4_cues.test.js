// rod4b in the slow lane (test link ?slow=rod4): hedged, careful cues for the new classes; nothing changes without the flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROD4_NAMES, ROD2_NAMES, ROD4, MODELS, SECONDARY, WATCH_CLASSES, pickModel, pickSecondary, canonical, CONFIG } from '../docs/js/config.js';
import { rod4Confirm, rod4Candidates, rod4Text } from '../docs/js/rod4cues.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { isSafeText } from '../docs/js/safetext.js';

const W = 480, H = 640;
const det = (name, score = 0.7, x1 = 180, y1 = 300, x2 = 300, y2 = 600) => ({ name, x1, y1, x2, y2, score });
const cands = (dets) => rod4Candidates(dets, W, H, ROD4.speak, { corridor: CONFIG.corridor });

test('class list: 42 names, rod2 first, in the label-map order', () => {
  assert.equal(ROD4_NAMES.length, 42);
  assert.deepEqual(ROD4_NAMES.slice(0, 30), ROD2_NAMES);
  assert.deepEqual(ROD4_NAMES.slice(30), ['kerb', 'kerb_drop', 'dropped_kerb', 'pothole', 'pavement_crack', 'e_scooter',
    'construction_barrier', 'tactile_paving', 'ped_signal', 'a_board', 'sidewalk', 'zebra_crossing']);
});

test('default stays rod2; ?slow=rod4 only swaps the slow lane model', () => {
  assert.equal(pickSecondary(null), SECONDARY);
  assert.equal(pickSecondary('anything else'), SECONDARY);
  assert.equal(SECONDARY.model, 'rod2');
  const r4 = pickSecondary('rod4');
  assert.equal(r4.model, 'rod4');
  assert.deepEqual(r4.classes, SECONDARY.classes);
  assert.equal(r4.conf, SECONDARY.conf);
  assert.equal(pickModel('rod4', null, 320).key, 'wotr', 'rod4 can never be the main model');
  assert.equal(MODELS.rod4.url(416), 'models/rod4_416.onnx');
});

test('the new classes never reach the tracker (SECONDARY.classes), and the speakable ones are all in the model', () => {
  for (const n of [...Object.keys(ROD4.speak), ...ROD4.logOnly]) {
    assert.ok(ROD4_NAMES.map(canonical).includes(n), n);
    assert.ok(!SECONDARY.classes.includes(n), n);
    assert.ok(WATCH_CLASSES.rod4.includes(n), `${n} is logged`);
  }
  assert.deepEqual(Object.keys(ROD4.speak).sort(), ['a_board', 'construction_barrier', 'e_scooter', 'kerb', 'kerb_drop', 'pothole']);
  for (const n of ['ped_signal', 'dropped_kerb', 'tactile_paving', 'sidewalk', 'zebra_crossing', 'pavement_crack']) assert.ok(!ROD4.speak[n], `${n} is never spoken`);
});

test('wording is a short hedge with no distance, never safe or clear', () => {
  assert.equal(rod4Text('kerb', 'ahead', ROD4.speak), 'Possible kerb ahead. Check with your cane.');
  assert.equal(rod4Text('a_board', 'left', ROD4.speak), 'Possible A-board ahead, left. Check with your cane.');
  assert.equal(rod4Text('pothole', 'right', ROD4.speak), 'Possible uneven ground ahead, right. Take care.');
  for (const n of Object.keys(ROD4.speak)) for (const dir of ['ahead', 'left', 'right']) {
    const t = rod4Text(n, dir, ROD4.speak);
    assert.ok(isSafeText(t), t);
    assert.doesNotMatch(t, /\b(safe|clear|all clear|fine)\b/i);
    assert.doesNotMatch(t, /\d/, 'no distance');
  }
});

test('must score minScore and be seen in two slow runs in a row', () => {
  let r = rod4Confirm([det('kerb', 0.7)], null, ROD4.speak);
  assert.equal(r.dets.length, 0, 'first sighting is not spoken');
  r = rod4Confirm([det('kerb', 0.7)], r.names, ROD4.speak);
  assert.equal(r.dets.length, 1, 'second run in a row');
  r = rod4Confirm([det('kerb', 0.40)], new Set(['kerb']), ROD4.speak);
  assert.equal(r.dets.length, 0, 'under minScore');
  r = rod4Confirm([det('ped_signal', 0.99), det('sidewalk', 0.99), det('Car', 0.99)], new Set(['ped_signal', 'sidewalk']), ROD4.speak);
  assert.equal(r.dets.length, 0, 'log-only classes and old classes are not cues');
});

test('only in the walking path and low in the picture', () => {
  assert.equal(cands([det('kerb')]).length, 1);
  assert.equal(cands([det('kerb', 0.7, 180, 100, 300, 250)]).length, 0, 'far (high in the picture)');
  assert.equal(cands([det('kerb', 0.7, 0, 400, 20, 600)]).length, 0, 'far to the side');
  assert.equal(cands([det('sidewalk'), det('ped_signal')]).length, 0);
});

test('spoken once per encounter, not in quiet mode, and inside the talk budget', () => {
  const run = (level) => {
    const e = new AlertEngine(CONFIG, level); const said = [];
    for (let i = 0; i < 40; i++) { const a = e.next([], W, H, 1000 + i * 250, cands([det('kerb')])); if (a) said.push(a.text); }
    return said;
  };
  assert.deepEqual(run('normal'), ['Possible kerb ahead. Check with your cane.'], 'once while it stays in view');
  assert.deepEqual(run('detailed'), ['Possible kerb ahead. Check with your cane.']);
  assert.deepEqual(run('quiet'), [], 'quiet mode stays quiet');
});

test('a vehicle or stairs warning still comes before a rod4 cue', () => {
  const e = new AlertEngine(CONFIG, 'normal');
  const stairs = { id: 1, name: 'stairs', box: { x1: 180, y1: 300, x2: 300, y2: 620 }, hits: 3, score: 0.9, dist: null, speed: null };
  const a = e.next([stairs], W, H, 5000, cands([det('kerb')]));
  assert.match(a.text, /^Stairs/);
});
