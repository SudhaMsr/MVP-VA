// Package E: the hazard lane speaks only graduated classes, hedged, below vehicles and stairs, once per encounter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { graduate, hazardCandidates, hazardText, GRADUATION, NEVER_SPEAK } from '../docs/js/hazardalerts.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { CONFIG, HAZARD } from '../docs/js/config.js';
import { isSafeText } from '../docs/js/safetext.js';

const W = 480, H = 640;
const det = (name, x1 = 180, y1 = 300, x2 = 300, y2 = 600, score = 0.6) => ({ name, x1, y1, x2, y2, score });
const cands = (dets, classes = ['e_scooter', 'a_board']) => hazardCandidates(dets, W, H, classes, { corridor: CONFIG.corridor });

test('graduation: precision >= 0.9, recall >= 0.6, at least 50 labelled examples', () => {
  assert.deepEqual(GRADUATION, { precision: 0.9, recall: 0.6, minExamples: 50 });
  const rows = graduate({ classes: {
    e_scooter: { precision: 0.93, recall: 0.71, tp: 60, fp: 4, fn: 24 },
    a_board: { precision: 0.95, recall: 0.8, tp: 30, fp: 1, fn: 7 },
    bollard: { precision: 0.85, recall: 0.9, tp: 90, fp: 16, fn: 10 },
    pothole: { precision: 0.92, recall: 0.4, tp: 40, fp: 3, fn: 60 },
    kerb: { precision: null, recall: null, tp: 0, fp: 0, fn: 0 },
    ped_signal: { precision: 0.99, recall: 0.99, tp: 500, fp: 1, fn: 1 },
  } });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.e_scooter.pass, true);
  assert.equal(by.a_board.pass, false); assert.match(by.a_board.why.join(), /37 labelled examples/);
  assert.equal(by.bollard.pass, false); assert.match(by.bollard.why.join(), /precision/);
  assert.equal(by.pothole.pass, false); assert.match(by.pothole.why.join(), /recall/);
  assert.equal(by.kerb.pass, false);
  assert.equal(by.ped_signal.pass, false, 'a crossing light is never spoken from this lane');
  assert.deepEqual(rows.filter((r) => r.pass).map((r) => r.name), ['e_scooter']);
  assert.ok(NEVER_SPEAK.includes('ped_signal'));
});

test('only classes in speakClasses produce candidates; by default none do', () => {
  assert.deepEqual(hazardCandidates([det('e_scooter')], W, H, HAZARD.speakClasses, { corridor: CONFIG.corridor }), []);
  assert.deepEqual(cands([det('bollard')]), [], 'not graduated');
  assert.deepEqual(cands([det('ped_signal')], ['ped_signal']), [], 'never, even if listed');
  assert.equal(cands([det('e_scooter')]).length, 1);
  assert.deepEqual(cands([det('e_scooter', 180, 50, 300, 200)]), [], 'far away (high in the picture): not yet');
  assert.deepEqual(cands([det('e_scooter', 0, 300, 40, 600)]), [], 'outside the walking path');
});

test('wording is hedged and short, with no distance', () => {
  assert.equal(hazardText('e_scooter', 'left'), 'Possible e-scooter ahead, left.');
  assert.equal(hazardText('a_board', 'ahead'), 'Possible A-board ahead.');
  const c = cands([det('e_scooter', 60, 300, 200, 600)])[0];
  assert.equal(c.text, 'Possible e-scooter ahead, left.');
  assert.equal(c.d, null); assert.doesNotMatch(c.text, /step|metre|yard/);
  assert.equal(c.priority, 2); assert.equal(c.once, true);
  for (const n of HAZARD.names) for (const d of ['ahead', 'left', 'right']) assert.ok(isSafeText(hazardText(n, d)));
});

test('spoken once per encounter, inside the alert budget', () => {
  const e = new AlertEngine(CONFIG, 'quiet');
  const said = [];
  for (let t = 0; t <= 20000; t += 500) { const a = e.next([], W, H, t, cands([det('e_scooter')])); if (a) said.push(a.text); }
  assert.deepEqual(said, ['Possible e-scooter ahead.'], 'quiet mode hears it, once');
});

test('moving vehicles and stairs still come first', () => {
  const car = { id: 1, cls: 10, name: 'car', hits: 8, speedN: 8, dist: 8, speed: 9, box: { x1: 200, y1: 300, x2: 300, y2: 400 } };
  const stairs = { id: 2, cls: 99, name: 'stairs', hits: 3, dist: null, speed: null, box: { x1: 150, y1: 400, x2: 330, y2: 620 } };
  const e = new AlertEngine(CONFIG, 'quiet');
  const a = e.next([car], W, H, 0, cands([det('e_scooter')]));
  assert.ok(a.urgent && /Car approaching/.test(a.text), a && a.text);
  const e2 = new AlertEngine(CONFIG, 'quiet');
  assert.match(e2.next([stairs], W, H, 0, cands([det('e_scooter')])).text, /^Stairs/);
  const e3 = new AlertEngine(CONFIG, 'quiet');
  assert.equal(e3.next([], W, H, 0, cands([det('e_scooter')])).text, 'Possible e-scooter ahead.');
});

test('tools: graduate.mjs and the model check exist; the model is cached like the others', () => {
  for (const f of ['../tools/phase4/graduate.mjs', '../tools/phase4/check_hazard_model.mjs']) assert.ok(fs.existsSync(new URL(f, import.meta.url)), f);
  const app = fs.readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /hd\.load\(HAZARD\.file/, 'loaded through Detector.load, which keeps it in the model cache (modelcache.js)');
  assert.match(app, /urls\.push\(HAZARD\.file\)/, 'warmed before start once a class may speak');
});
