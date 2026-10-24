import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine } from '../docs/js/alerts.js';
import { Speaker } from '../docs/js/speech.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const W = 640, H = 480;
const idx = (n) => CLASSES.indexOf(n);
const AHEAD = { x1: 280, y1: 200, x2: 360, y2: 300 }, RIGHT = { x1: 500, y1: 200, x2: 600, y2: 300 };
const tr = (name, dist, box = AHEAD, extra = {}) => [{ id: 1, cls: idx(name), name, hits: 5, dist, speed: 0, box, ...extra }];

test('a still bus 2 m ahead is not repeated every few seconds', () => {
  const eng = new AlertEngine(); let said = 0;
  for (let t = 0; t <= 60000; t += 1000) if (eng.next(tr('bus', 2), W, H, t)) said += 1;
  assert.ok(said <= 5, `spoke ${said} times in a minute`);
  assert.ok(said >= 2, 'should still remind the walker now and then');
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
  assert.match(new AlertEngine().next(tr('person', 2.0, RIGHT), W, H, 0).text, /Person, right/);
  assert.match(new AlertEngine().next(tr('person', 3.5, AHEAD), W, H, 0).text, /Person, ahead/);
});

test('urgent vehicle alerts ignore the side filter and the budget', () => {
  const eng = new AlertEngine();
  const car = tr('car', 9, RIGHT, { speed: 4 });
  assert.equal(eng.next(car, W, H, 0).priority, 0);
  eng.spokenAt = [0, 0, 0]; // budget already used up
  assert.ok(eng.next(tr('car', 4, AHEAD, { id: 2 }), W, H, 100), 'very near car must still be spoken');
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
