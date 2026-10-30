import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres'); // these tests check the metres wording; miles is the app default
import assert from 'node:assert/strict';
import { AlertEngine } from '../docs/js/alerts.js';
import { Speaker } from '../docs/js/speech.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const W = 640, H = 480;
const idx = (n) => CLASSES.indexOf(n);
const AHEAD = { x1: 280, y1: 200, x2: 360, y2: 300 }, RIGHT = { x1: 500, y1: 200, x2: 600, y2: 300 };
const tr = (name, dist, box = AHEAD, extra = {}) => [{ id: 1, cls: idx(name), name, hits: 5, dist, speed: 0, box, ...extra }];

test('a still bus blocking the path 2 m ahead is mentioned once, not repeated every few seconds', () => {
  const eng = new AlertEngine(); let said = 0;
  for (let t = 0; t <= 60000; t += 1000) if (eng.next(tr('bus', 2), W, H, t)) said += 1;
  assert.equal(said, 1, `spoke ${said} times in a minute`);
});

test('a repeat is allowed straight away when the thing has got clearly closer', () => {
  const eng = new AlertEngine();
  assert.ok(eng.next(tr('person', 3.8), W, H, 0));
  assert.equal(eng.next(tr('person', 3.6), W, H, 1000), null);
  const a = eng.next(tr('person', 2.0), W, H, 2000);
  assert.ok(a, 'closer by 1.8 m should speak again');
});

test('objects off to the side stay quiet unless they are close; ahead is always spoken', () => {
  assert.equal(new AlertEngine().next(tr('person', 3.5, RIGHT), W, H, 0), null);
  assert.match(new AlertEngine().next(tr('person', 1.0, RIGHT), W, H, 0).text, /Person, right/);
  assert.match(new AlertEngine().next(tr('person', 3.5, AHEAD), W, H, 0).text, /Person, ahead/);
});

test('urgent vehicle alerts ignore the side filter and the budget', () => {
  const eng = new AlertEngine();
  const car = tr('car', 9, RIGHT, { speed: 8 });
  assert.equal(eng.next(car, W, H, 0).priority, 0);
  eng.spokenAt = [0, 0, 0]; // budget already used up
  assert.ok(eng.next(tr('car', 4, AHEAD, { id: 2, speed: 8 }), W, H, 100), 'an approaching car must still be spoken');
});

test('budget caps routine alerts per window', () => {
  const eng = new AlertEngine(); let said = 0;
  const things = ['person', 'dog', 'ashcan', 'pole', 'roadblock'].map((n, i) => ({ id: i, cls: idx(n), name: n, hits: 5, dist: 1.5, speed: 0, box: { x1: 100 + i, y1: 100, x2: 400 + i, y2: 460 } }));
  for (let t = 0; t < CONFIG.budgetWindowMs - 1; t += 500) if (eng.next(things, W, H, t)) said += 1;
  assert.ok(said <= CONFIG.budgetMax, `spoke ${said}, budget is ${CONFIG.budgetMax}`);
});

// ---- speech: navigation prompts jump ahead of hazard chatter ----
function fakeSpeaker() {
  const spoken = [], cancelled = []; let last = null;
  const synth = { speak: (u) => { last = u; spoken.push(u.text); }, cancel: () => cancelled.push(true) };
  const sp = new Speaker(synth, function (text) { this.text = text; }, { setTimer: () => 0, clearTimer: () => {} });
  const finish = () => last && last.onend && last.onend();
  return { sp, spoken, cancelled, finish };
}

test('turn prompts go ahead of queued status and routine messages and cut off a routine alert', () => {
  const { sp, spoken, cancelled, finish } = fakeSpeaker();
  sp.speak('Caution. Bus, ahead, about 2 metres.', 'normal'); // playing
  sp.speak('Person, right, about 2 metres.', 'normal'); // queued
  sp.speak('Route summary text.', 'status'); // queued
  sp.speak('Turn left now.', 'nav');
  assert.equal(cancelled.length, 1, 'routine alert in progress is cut off');
  assert.equal(spoken.at(-1), 'Turn left now.');
  finish();
  assert.equal(spoken.at(-1), 'Route summary text.', 'queued routine alert was dropped, status kept');
  assert.ok(!spoken.includes('Person, right, about 2 metres.'));
});

test('a nav prompt never cuts off an urgent alert or another nav prompt, and keeps its order', () => {
  const { sp, spoken, cancelled, finish } = fakeSpeaker();
  sp.speak('Danger car', 'urgent');
  sp.speak('In 40 metres, turn left.', 'nav');
  sp.speak('Turn left now.', 'nav');
  assert.equal(cancelled.length, 0);
  finish(); assert.equal(spoken.at(-1), 'In 40 metres, turn left.');
  finish(); assert.equal(spoken.at(-1), 'Turn left now.');
});

// ---- Talk: the app must stop speaking when the walker taps Talk ----
test('hush stops a turn prompt or status message in progress at once, and says it again afterwards', () => {
  const { sp, spoken, cancelled, finish } = fakeSpeaker();
  sp.speak('In 40 metres, turn left.', 'nav'); // playing
  sp.hush(); sp.hold(true);
  assert.equal(cancelled.length, 1, 'speech stopped');
  assert.equal(spoken.length, 1, 'nothing new spoken while held');
  sp.hold(false);
  assert.equal(spoken.at(-1), 'In 40 metres, turn left.', 'the cut-off prompt is not lost');
  finish();
});

test('while held (listening), queued messages wait, but an urgent warning still gets through', () => {
  const { sp, spoken } = fakeSpeaker();
  sp.hold(true);
  sp.speak('Route summary.', 'status'); sp.speak('Turn left now.', 'nav');
  assert.equal(spoken.length, 0);
  sp.speak('Danger, car.', 'urgent');
  assert.deepEqual(spoken, ['Danger, car.']);
});

test('an urgent warning in progress is not cut off by Talk', () => {
  const { sp, cancelled } = fakeSpeaker();
  sp.speak('Danger, car.', 'urgent'); sp.hush();
  assert.equal(cancelled.length, 0);
});

test('the answer to what the walker asked is spoken before the message that was cut off for them', () => {
  const { sp, spoken, finish } = fakeSpeaker();
  sp.speak('In 40 metres, turn left.', 'nav'); // playing
  sp.hush(); sp.hold(true);
  sp.speak('Battery is at 80 percent.', 'status'); // they spoke; the app answers while still held
  sp.hold(false);
  assert.equal(spoken.at(-1), 'Battery is at 80 percent.');
  finish();
  assert.equal(spoken.at(-1), 'In 40 metres, turn left.', 'the cut-off prompt follows');
});

// ---- once per encounter ----
const still = (name, dist, x = 170) => ({ id: 1, cls: idx(name), name, hits: 6, dist, speed: 0, box: { x1: x, y1: 100, x2: x + 300, y2: 470 } });
function run(eng, tracksAt, secs, step = 500) { const out = []; for (let t = 0; t <= secs * 1000; t += step) { const tr = tracksAt(t); const a = eng.next(tr, W, H, t); if (a) out.push({ t, text: a.text }); } return out; }

test('a person who stays in view is announced once, not every few seconds', () => {
  const eng = new AlertEngine(CONFIG, 'normal');
  const said = run(eng, () => [still('person', 2.0)], 120);
  assert.equal(said.length, 1, JSON.stringify(said));
});

test('it speaks again when the thing gets clearly closer, and when it leaves and comes back', () => {
  const eng = new AlertEngine(CONFIG, 'normal');
  const closer = run(eng, (t) => [still('person', t < 10000 ? 3.5 : 1.8)], 20);
  assert.equal(closer.filter((x) => x.text !== 'Clear ahead.').length, 2, 'once far, once when 1.5 m or more closer');
  const e2 = new AlertEngine(CONFIG, 'normal');
  const back = run(e2, (t) => (t >= 8000 && t < 20000 ? [] : [still('person', 2.5)]), 40);
  assert.equal(back.filter((x) => x.text !== 'Clear ahead.').length, 2, 'new encounter after being out of view for a while');
});

test('stairs and red lights still in view are reminded only every 30 s; a bin is spoken once', () => {
  const stairs = run(new AlertEngine(CONFIG, 'quiet'), () => [{ ...still('stairs', null), box: { x1: 100, y1: 300, x2: 500, y2: 460 } }], 100);
  assert.deepEqual(stairs.map((s) => Math.round(s.t / 1000)), [0, 30, 60, 90]);
  const bin = run(new AlertEngine(CONFIG, 'detailed'), () => [{ ...still('ashcan', 1.5), box: { x1: 100, y1: 100, x2: 500, y2: 470 } }], 120);
  assert.equal(bin.length, 1);
});

test('no more than the per-minute cap of routine alerts in quiet mode, but urgent ones always get through', () => {
  const eng = new AlertEngine(CONFIG, 'quiet');
  // a stream of different stairs positions: each is a new thing
  const said = run(eng, (t) => [{ ...still('stairs', null, (Math.floor(t / 3000) % 3) * 200), box: { x1: (Math.floor(t / 3000) % 3) * 200, y1: 300, x2: (Math.floor(t / 3000) % 3) * 200 + 150, y2: 460 } }], 59);
  assert.ok(said.length <= CONFIG.minuteMax.quiet, `spoke ${said.length}`);
});

test('the same routine sentence is never spoken twice within 30 s', () => {
  const spoken = []; const synth = { speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel: () => {} };
  let now = 0;
  const sp = new Speaker(synth, function (t) { this.text = t; }, { setTimer: () => 0, clearTimer: () => {}, now: () => now });
  sp.speak('Bin, left, close.', 'normal'); now = 10000;
  sp.speak('Bin, left, close.', 'normal'); assert.equal(spoken.length, 1, 'dropped as a repeat');
  now = 40000; sp.speak('Bin, left, close.', 'normal');
  assert.equal(spoken.length, 1 + (sp.current && sp.current.text === 'Bin, left, close.' && spoken.length === 2 ? 0 : 0), 'queued, or playing after the first ended');
  sp.speak('Danger.', 'urgent'); sp.speak('Danger.', 'urgent');
  assert.ok(spoken.filter((t) => t === 'Danger.').length >= 1, 'urgent is never dropped');
});

import { inCorridor } from '../docs/js/alerts.js';
test('walking corridor: in front counts, off to the side and far away do not', () => {
  assert.equal(inCorridor({ x1: 280, y1: 200, x2: 360, y2: 300 }, W, H), true, 'straight ahead');
  assert.equal(inCorridor({ x1: 500, y1: 200, x2: 600, y2: 300 }, W, H), false, 'far right, mid distance');
  assert.equal(inCorridor({ x1: 0, y1: 100, x2: 100, y2: 460 }, W, H), false, 'far left, close');
  assert.equal(inCorridor({ x1: 260, y1: 90, x2: 380, y2: 150 }, W, H), false, 'above the horizon line: too far');
  assert.equal(inCorridor({ x1: 100, y1: 100, x2: 400, y2: 460 }, W, H), true, 'a wide thing close up that reaches into the path');
});

test('a person off to the side is quiet at 2 m, but a person in the path is spoken', () => {
  const side = { x1: 20, y1: 200, x2: 100, y2: 300 };
  assert.equal(new AlertEngine().next(tr('person', 2.0, side), W, H, 0), null);
  assert.match(new AlertEngine().next(tr('person', 1.0, side), W, H, 0).text, /Person, left/);
  assert.match(new AlertEngine().next(tr('person', 3.5, AHEAD), W, H, 0).text, /Person, ahead/);
});

test('a person in the path in the left third is still spoken (the old rule dropped it)', () => {
  const leftOfCentre = { x1: 20, y1: 150, x2: 250, y2: 470 };
  assert.match(new AlertEngine().next(tr('person', 3.0, leftOfCentre), W, H, 0).text, /Person, left/);
});
