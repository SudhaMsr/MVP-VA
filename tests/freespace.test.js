import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import assert from 'node:assert/strict';
import { FreeSpace } from '../docs/js/freespace.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { CLASSES } from '../docs/js/config.js';

const W = 640, H = 480, idx = (n) => CLASSES.indexOf(n);
const T = (name, dist, x1, x2, id = 1) => ({ id, cls: idx(name), name, hits: 5, dist, speed: 0, box: { x1, y1: 150, x2, y2: 420 } });
const run = (fs, tracks, n = 8) => { let a; for (let i = 0; i < n; i++) a = fs.update(tracks, W, H); return a; };

test('nothing in the way: no advice', () => {
  assert.equal(run(new FreeSpace(), [T('person', 6, 280, 360)]), null);
});

test('a person straight ahead with the right side open: clearer on the right', () => {
  const a = run(new FreeSpace(), [T('person', 2, 235, 330)]); // left and centre lanes
  assert.equal(a.text, 'Clearer on the right.');
});

test('blocked ahead and on the left: clearer on the right; blocked all across: stop', () => {
  const fs = new FreeSpace();
  assert.equal(run(fs, [T('person', 2, 120, 340)]).text, 'Clearer on the right.');
  const fs2 = new FreeSpace();
  assert.deepEqual(run(fs2, [T('bench', 2, 100, 560)]).stop, true);
});

test('one frame of a blocker does not change the advice (no flicker)', () => {
  const fs = new FreeSpace();
  assert.equal(fs.update([T('person', 2, 235, 330)], W, H), null, 'first frame is not enough');
  run(fs, [T('person', 2, 235, 330)]);
  assert.ok(fs.advice());
  fs.update([], W, H); // a single empty frame
  assert.ok(fs.advice(), 'still blocked after one gap frame');
});

test('clear ahead is said once after a blocked warning, not before', () => {
  const fs = new FreeSpace();
  run(fs, []);
  assert.equal(fs.peekClear(), null, 'never blocked, nothing to say');
  run(fs, [T('person', 2, 235, 330)]);
  fs.announcedBlocked = true;
  run(fs, [], 30);
  assert.equal(fs.peekClear(), 'Clear ahead.');
  assert.equal(fs.peekClear(), 'Clear ahead.', 'looking does not use it up');
  fs.spokenClear();
  assert.equal(fs.peekClear(), null, 'only once, after it has been said');
});

test('the alert names the obstacle and says which side is clearer, in one sentence', () => {
  const eng = new AlertEngine(); let a = null;
  for (let t = 0; t < 600 && !a; t += 50) a = eng.next([T('person', 2, 235, 330)], W, H, t);
  assert.match(a.text, /^Person, (ahead|left), about 2 metres\. Clearer on the right\.$/);
});

test('a person far off to the side adds no steering advice', () => {
  const eng = new AlertEngine(); let a = null;
  for (let t = 0; t < 600 && !a; t += 50) a = eng.next([T('person', 1, 10, 80)], W, H, t);
  assert.ok(a); assert.doesNotMatch(a.text, /Clearer/);
});
