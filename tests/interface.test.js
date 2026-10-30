import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres'); // these tests check the metres wording; miles is the app default
import assert from 'node:assert/strict';
import { AlertEngine, LEVELS } from '../docs/js/alerts.js';
import { Cues } from '../docs/js/cues.js';
import { Speaker } from '../docs/js/speech.js';
import { parseCommand } from '../docs/js/commands.js';
import { Navigator } from '../docs/js/nav.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const W = 640, H = 480, idx = (n) => CLASSES.indexOf(n);
const AHEAD = { x1: 280, y1: 200, x2: 360, y2: 300 };
const tr = (name, dist, box = AHEAD, extra = {}) => ({ id: Math.random(), cls: idx(name), name, hits: 5, dist, speed: 0, box, ...extra });
const say = (level, tracks) => { const e = new AlertEngine(CONFIG, level); return e.next(tracks, W, H, 0); };

test('new users start in quiet mode', () => assert.equal(CONFIG.verbosity, 'quiet'));

test('quiet: only urgent, falls, and things very close ahead', () => {
  assert.equal(say('quiet', [tr('person', 3.5)]), null, 'person 3.5 m ahead is not worth saying');
  assert.match(say('quiet', [tr('person', 1.5)]).text, /Person, ahead/);
  assert.equal(say('quiet', [tr('ashcan', 1, AHEAD, { box: { x1: 200, y1: 100, x2: 440, y2: 470 } })]), null, 'a bin: the cane finds it');
  assert.equal(say('quiet', [tr('pole', 1, AHEAD, { box: { x1: 200, y1: 100, x2: 440, y2: 470 } })]), null);
  assert.match(say('quiet', [tr('car', 4, AHEAD, { speed: 8 })]).text, /Caution/, 'urgent (approaching) vehicles always');
  const parked = say('quiet', [tr('car', 4, AHEAD, { hits: 6 })]);
  assert.ok(parked && parked.priority !== 0 && /^Parked car/.test(parked.text), 'a parked car in the path is mentioned, never as urgent');
  assert.match(say('quiet', [tr('stairs', 5, { x1: 250, y1: 300, x2: 400, y2: 460 })]) .text, /Stairs/, 'fall hazard always');
});

test('normal: people and vehicles yes, static cane-found objects no', () => {
  assert.match(say('normal', [tr('person', 3.5)]).text, /Person, ahead/);
  const bin = tr('ashcan', 1, AHEAD, { box: { x1: 200, y1: 100, x2: 440, y2: 470 } });
  assert.equal(say('normal', [bin]), null);
  assert.match(say('detailed', [bin]).text, /Bin/);
});

test('levels step in order and unknown levels are ignored', () => {
  assert.deepEqual(LEVELS, ['quiet', 'normal', 'detailed']);
  const e = new AlertEngine(CONFIG, 'quiet');
  assert.equal(e.setLevel('nonsense'), 'quiet');
  assert.equal(e.setLevel('detailed'), 'detailed');
});

test('voice commands change talkativeness (and "be quiet" does not stop the app)', () => {
  assert.deepEqual(parseCommand('less talk please'), { type: 'level', arg: 'less' });
  assert.deepEqual(parseCommand('be quiet'), { type: 'level', arg: 'less' });
  assert.deepEqual(parseCommand('more detail'), { type: 'level', arg: 'more' });
  assert.deepEqual(parseCommand('quiet mode'), { type: 'level', arg: 'quiet' });
  assert.deepEqual(parseCommand('normal mode'), { type: 'level', arg: 'normal' });
  assert.deepEqual(parseCommand('detailed mode'), { type: 'level', arg: 'detailed' });
  assert.equal(parseCommand('stop').type, 'stop');
  assert.equal(parseCommand('navigate to the quiet cafe').type, 'navigate');
});

// ---- sounds ----
function fakeAudio() {
  const made = [];
  class Ctx {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; }
    createOscillator() { const o = { frequency: {}, connect() {}, start() { made.push(o.frequency.value); }, stop() {} }; return o; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
  }
  return { Ctx, made };
}

test('sounds stay silent until a tap unlocks audio, then each has its own tones', () => {
  const { Ctx, made } = fakeAudio(); const buzz = [];
  const c = new Cues({ AudioCtx: Ctx, vibrate: (p) => buzz.push(p) });
  assert.equal(c.play('ok'), false);
  assert.equal(c.unlock(), true);
  assert.equal(c.play('listen'), true); assert.deepEqual(made.splice(0), [660, 880]);
  c.play('ok'); assert.deepEqual(made.splice(0), [880]);
  c.play('huh'); assert.deepEqual(made.splice(0), [330, 247]);
  c.play('urgent'); assert.deepEqual(made.splice(0), [1040]);
  assert.ok(buzz.some((p) => Array.isArray(p)), 'urgent buzzes');
  assert.equal(c.play('nonsense'), false);
});

test('missing audio or vibration support never throws', () => {
  const c = new Cues({ AudioCtx: null, vibrate: null });
  assert.equal(c.unlock(), false); assert.equal(c.play('urgent'), false);
});

// ---- hush ----
test('hush drops routine speech and stops what is playing, but keeps turn prompts and status messages queued', () => {
  const spoken = []; let cancelled = 0;
  const synth = { speak: (u) => { spoken.push(u.text); }, cancel: () => { cancelled++; } };
  const sp = new Speaker(synth, function (t) { this.text = t; }, { setTimer: () => 0, clearTimer: () => {} });
  sp.speak('Person, ahead, about 3 metres.', 'normal'); // playing
  sp.speak('Bin, left, close.', 'normal'); sp.speak('Turn left now.', 'nav'); sp.speak('Route summary.', 'status');
  sp.hush();
  assert.ok(cancelled >= 1, 'speech stopped');
  assert.equal(sp.current, null, 'nothing is playing after Talk is tapped');
  assert.deepEqual(sp.queue.map((q) => q.text), ['Turn left now.', 'Route summary.'], 'routine dropped, the rest kept in order');
});

// ---- reassurance ----
test('on a long quiet straight the walker is reassured, once per interval', async () => {
  const said = []; let cb, clock = 0;
  const A = { lat: 51, lon: 0 }, B = { lat: 51, lon: 0.004 }; // about 280 m east
  const route = { distance: 280, duration: 200, source: 'google', steps: [
    { distance: 280, name: '', text: 'walk ahead', maneuver: { type: 'depart', location: [0, 51] }, at: A, path: [A, B] },
    { distance: 0, name: '', text: 'you have arrived', maneuver: { type: 'arrive', location: [0.004, 51] }, at: B, path: [] }] };
  const nav = new Navigator({ say: (t) => said.push(t), now: () => clock, providers: { route: async () => route, geocode: async () => ({ ...B, name: 'Dest' }) },
    getPosition: async () => A, watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
  await nav.start('x'); said.length = 0;
  cb({ lat: 51, lon: 0.0002, accuracy: 8 }); // first fix
  cb({ lat: 51, lon: 0.0004, accuracy: 8 }); // orientation says "right way"
  said.length = 0;
  clock = 10000; cb({ lat: 51, lon: 0.0006, accuracy: 8 }); assert.equal(said.length, 0, 'too soon');
  clock = 100000; cb({ lat: 51, lon: 0.0008, accuracy: 8 }); // reassurance is rare now: 90 seconds of quiet
  assert.match(said.at(-1), /Keep going\. You are on the route\. Your destination is about \d+ metres away\./);
  const n = said.length; clock = 110000; cb({ lat: 51, lon: 0.001, accuracy: 8 });
  assert.equal(said.length, n, 'not repeated straight away');
  const n2 = said.length;
  clock = 200000; cb({ lat: 51, lon: 0.0034, accuracy: 8 }); // ~40 m from the end: near, no reassurance
  assert.ok(!said.slice(n2).some((t) => /Keep going/.test(t)));
});

test('spoken phrasings seen in field testing: address first, stuttered "to me to", battery', () => {
  assert.deepEqual(parseCommand('save 25 lakeside bs16 3ee as a home'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('save 25 lakeside bs16 3ee as home'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('save this place as home'), { type: 'save', arg: 'home' }, 'still means here');
  assert.deepEqual(parseCommand('navigate to me to university of bristol'), { type: 'navigate', arg: 'university of bristol' });
  assert.deepEqual(parseCommand('navigate me to home'), { type: 'navigate', arg: 'home' });
  assert.equal(parseCommand('what is my battery percentage').type, 'battery');
});

test('"I lost your location signal." is said once, then at most once a minute', async () => {
  const said = []; let cb, err, clock = 0;
  const A = { lat: 51, lon: 0 }, B = { lat: 51, lon: 0.004 };
  const route = { distance: 280, duration: 200, source: 'google', steps: [
    { distance: 280, name: '', text: 'walk ahead', maneuver: { type: 'depart', location: [0, 51] }, at: A, path: [A, B] },
    { distance: 0, name: '', text: 'you have arrived', maneuver: { type: 'arrive', location: [0.004, 51] }, at: B, path: [] }] };
  const nav = new Navigator({ say: (t) => said.push(t), now: () => clock, providers: { route: async () => route, geocode: async () => ({ ...B, name: 'Dest' }) },
    getPosition: async () => A, watch: (f, e) => { cb = f; err = e; return 1; }, unwatch: () => {} });
  await nav.start('x'); said.length = 0;
  for (clock = 1000; clock < 50000; clock += 1000) err();
  assert.equal(said.filter((t) => /lost your location/.test(t)).length, 1, 'once in the first 50 s');
  clock = 70000; err();
  assert.equal(said.filter((t) => /lost your location/.test(t)).length, 2, 'again after a minute');
});
