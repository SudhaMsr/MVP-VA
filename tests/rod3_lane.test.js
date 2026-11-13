// Phase 5: rod3 (40 classes) can run in the slow lane for supervised testing only, and none of its new classes is spoken.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MODELS, ROD2_NAMES, ROD3_NAMES, ROD3_NEW, SECONDARY, WATCH_CLASSES, slowModelKey, pickModel, canonical } from '../docs/js/config.js';

const labelMap = JSON.parse(fs.readFileSync(new URL('../tools/phase5/label_map.json', import.meta.url)));

test('rod3 class order matches the training label map exactly (old 30 first, new 10 after)', () => {
  assert.equal(ROD3_NAMES.length, 40);
  assert.deepEqual(ROD3_NAMES, labelMap.classes);
  assert.deepEqual(ROD3_NAMES.slice(0, 30), ROD2_NAMES, 'rod2 class ids must not move, or every old alert would break');
});

test('the slow lane stays rod2 unless a supervisor asks for rod3', () => {
  assert.equal(slowModelKey(null), 'rod2');
  assert.equal(slowModelKey(''), 'rod2');
  assert.equal(slowModelKey('rod4'), 'rod2');
  assert.equal(slowModelKey('rod3'), 'rod3');
  assert.equal(SECONDARY.model, 'rod2');
});

test('rod3 can never be picked as the main model', () => {
  assert.deepEqual(MODELS.rod3.sizes, []);
  assert.notEqual(pickModel('rod3', '416', 320).key, 'rod3');
  assert.equal(MODELS.rod3.url(416), 'models/rod3_416.onnx');
});

test('none of the ten new classes is spoken: they are not slow-lane alert classes, only watch-logged', () => {
  for (const n of ROD3_NEW) {
    assert.ok(!SECONDARY.classes.includes(canonical(n)), `${n} must not reach the alert tracker`);
    assert.ok(WATCH_CLASSES.rod3.includes(canonical(n)), `${n} is logged for the walk gate`);
  }
  for (const n of WATCH_CLASSES.rod2) assert.ok(WATCH_CLASSES.rod3.includes(n), 'rod3 logs everything rod2 logged');
});

test('app falls back to rod2 when the rod3 file is missing, so stairs and manholes keep working', () => {
  const src = fs.readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /slow-model-fallback/);
  assert.match(src, /logWatchClasses\(r\.dets, WATCH_CLASSES\[SLOW_KEY\]\)/);
});
