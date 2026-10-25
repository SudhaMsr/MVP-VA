import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits, getUnits, roundDistance, nearDistance, STEP_METRES } from '../docs/js/units.js';
import { describeScene, NOTHING } from '../docs/js/describe.js';
import { describePlace, normaliseName, PlaceStore } from '../docs/js/places.js';
import { BatteryWatch, batteryText } from '../docs/js/battery.js';
import { parseCommand } from '../docs/js/commands.js';
import { Dialogue } from '../docs/js/dialogue.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { Navigator, roundMetres } from '../docs/js/nav.js';
import { CLASSES, CONFIG } from '../docs/js/config.js';

const W = 640;
const T = (name, dist, x, hits = 5) => ({ name, dist, hits, box: { x1: x, x2: x + 60, y1: 100, y2: 300 } });

// ---------------- units ----------------
test('metres stay the default and wording is unchanged', () => {
  setUnits('metres');
  assert.equal(roundDistance(8), 'a few metres');
  assert.equal(roundDistance(43), '40 metres');
  assert.equal(roundDistance(1100), '1100 metres');
  assert.equal(nearDistance(1), 'very close');
  assert.equal(nearDistance(2), 'about 2 metres');
  assert.equal(nearDistance(1.6), 'about 2 metres');
});

test('steps: route and hazard distances convert at about 0.7 m, and unknown modes are ignored', () => {
  setUnits('steps');
  try {
    assert.equal(STEP_METRES, 0.7);
    assert.equal(roundDistance(3), 'a few steps');
    assert.equal(roundDistance(14), '20 steps');
    assert.equal(roundDistance(40), '60 steps'); // 57 steps
    assert.equal(roundDistance(100), '140 steps'); // 143 steps
    assert.equal(roundDistance(400), '550 steps'); // 571 steps, rounded to the nearest 50
    assert.equal(nearDistance(1), 'very close');
    assert.equal(nearDistance(2), 'about 3 steps');
    assert.equal(roundMetres(40), '60 steps', 'navigation uses the same setting');
    assert.equal(setUnits('furlongs'), 'steps');
  } finally { setUnits('metres'); }
});

test('hazard alerts and navigation prompts speak steps when asked', () => {
  const idx = (n) => CLASSES.indexOf(n);
  const car = [{ id: 1, cls: idx('person'), name: 'person', hits: 5, dist: 2.1, speed: 0, box: { x1: 280, y1: 200, x2: 360, y2: 300 } }];
  setUnits('steps');
  try { assert.match(new AlertEngine(CONFIG, 'normal').next(car, 640, 480, 0).text, /Person, ahead, about 3 steps\./); } finally { setUnits('metres'); }
  assert.match(new AlertEngine(CONFIG, 'normal').next(car, 640, 480, 0).text, /about 2 metres/);
});

test('units voice commands', () => {
  for (const p of ['use steps', 'switch to steps', 'distances in steps', 'give me steps', 'count in steps']) assert.deepEqual(parseCommand(p), { type: 'units', arg: 'steps' }, p);
  for (const p of ['use metres', 'switch to meters', 'distances in metres', 'give me metres']) assert.deepEqual(parseCommand(p), { type: 'units', arg: 'metres' }, p);
});

// ---------------- what is in front of me ----------------
test('scene description groups, orders by side and names distances', () => {
  setUnits('metres');
  const s = describeScene([T('bus', 2, 280), T('person', 3, 290), T('person', 2.5, 300), T('person', 2, 500), T('ashcan', 1.2, 20)], W);
  assert.match(s, /^Straight ahead: a bus, about 2 metres; and 2 people, about 3 metres\./);
  assert.match(s, /On your left: a bin, very close\./);
  assert.match(s, /On your right: a person, about 2 metres\./);
});

test('scene description is honest when nothing is recognised and ignores one-frame flickers', () => {
  assert.equal(describeScene([], W), NOTHING);
  assert.equal(describeScene([T('person', 2, 300, 1)], W), NOTHING);
  assert.match(NOTHING, /does not mean the way is clear/);
  assert.equal(describeScene([T('sign', 3, 300), T('building', 9, 100)], W), NOTHING, 'things we do not describe are not described');
});

test('scene description keeps the risky things when there is a lot to say, and uses articles and steps', () => {
  const many = [T('electrical_box', 2, 20), T('bench', 3, 30), T('pole', 4, 40), T('tree', 5, 50), T('chair', 6, 60), T('person', 2, 300), T('car', 9, 320)];
  const s = describeScene(many, W);
  assert.match(s, /a car/); assert.match(s, /a person/);
  assert.doesNotMatch(s, /electrical box/);
  assert.match(s, /There is more/);
  assert.match(describeScene([T('electrical_box', 2, 300)], W), /an electrical box/);
  assert.match(describeScene([T('stairs', null, 300)], W), /^Straight ahead: stairs\.$/);
  setUnits('steps'); try { assert.match(describeScene([T('person', 2.1, 300)], W), /about 3 steps/); } finally { setUnits('metres'); }
});

test('describe voice commands, without stealing "what is this place" from reading', () => {
  for (const p of ['what is in front of me', "what's ahead", 'what can you see', 'describe the scene', 'look around', 'is there anything ahead', 'what is around me'])
    assert.equal(parseCommand(p).type, 'describe', p);
  assert.equal(parseCommand('what is this place').type, 'read');
  assert.equal(parseCommand('read this').type, 'read');
});

// ---------------- where am I / saved places ----------------
test('where am I wording from an OpenStreetMap address', () => {
  assert.equal(describePlace({ address: { road: 'Queen Square', suburb: 'City Centre', city: 'Bristol', house_number: '12' } }),
    'You are near number 12, on Queen Square, in City Centre, Bristol.');
  assert.match(describePlace({ name: 'Bristol Old Vic', address: { road: 'King Street', city: 'Bristol' } }), /^You are on King Street, in Bristol\. Close by is Bristol Old Vic\.$/);
  assert.equal(describePlace({ address: { suburb: 'Redcliffe', city: 'Bristol' } }), 'You are in Redcliffe, Bristol.');
  assert.equal(describePlace({ address: {} }), 'I could not tell which street you are on.');
  assert.match(describePlace({ address: { road: 'Mill Lane', city: 'Bath' } }, 45), /signal is weak/);
  assert.doesNotMatch(describePlace({ address: { road: 'Mill Lane', city: 'Bath' } }, 10), /weak/);
});

test('where am I and save-place voice commands', () => {
  assert.equal(parseCommand('where am I').type, 'whereami');
  assert.equal(parseCommand('which street am I on').type, 'whereami');
  assert.deepEqual(parseCommand('save this place as home'), { type: 'save', arg: 'home' });
  assert.deepEqual(parseCommand('remember this place as the bakery'), { type: 'save', arg: 'the bakery' });
  assert.deepEqual(parseCommand('this is home'), { type: 'save', arg: 'home' });
  assert.deepEqual(parseCommand('save here'), { type: 'save', arg: '' });
  assert.deepEqual(parseCommand('take me home'), { type: 'navigate', arg: 'home' });
  assert.deepEqual(parseCommand('go home please'), { type: 'navigate', arg: 'home' });
  assert.deepEqual(parseCommand('take me to tesco'), { type: 'navigate', arg: 'tesco' });
});

test('saved places: names are normalised, kept in storage, replaced and listed', () => {
  assert.equal(normaliseName('My Home.'), 'home');
  const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const a = new PlaceStore(store);
  assert.deepEqual({ ...a.save('my home', { lat: 51, lon: -2 }) }, { name: 'home', replaced: false, persisted: true });
  assert.equal(a.save('Home', { lat: 52, lon: -2 }).replaced, true);
  a.save('the bakery', { lat: 51.1, lon: -2.1 });
  const b = new PlaceStore(store); // a new visit reads the same storage
  assert.equal(b.get('HOME').lat, 52);
  assert.deepEqual(b.list(), ['bakery', 'home']);
  assert.equal(b.get('office'), null);
  assert.equal(b.save('   ', { lat: 1, lon: 1 }), null);
  assert.equal(b.remove('bakery'), true); assert.deepEqual(b.list(), ['home']);
});

test('saved places still work, and say so, when storage is blocked', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const s = new PlaceStore(broken);
  const r = s.save('home', { lat: 1, lon: 2 });
  assert.equal(r.persisted, false, 'the app must not claim it was stored');
  assert.equal(s.get('home').lat, 1, 'but it is remembered for this visit');
});

test('take me home: a saved place goes straight to distance and yes/no, then starts', async () => {
  setUnits('metres');
  const said = []; let began = null;
  const route = { distance: 800, duration: 600, steps: [{ text: 'walk ahead', distance: 800 }] };
  const nav = { getPosition: async () => ({ lat: 51, lon: -2 }), plan: async () => route, begin: (...a) => { began = a; }, active: false };
  const d = new Dialogue({ say: (t) => said.push(t), nav });
  await d.navigateToSaved({ name: 'home', lat: 51.01, lon: -2 });
  assert.match(said.at(-1), /^your home\. 800 metres, about 10 minutes\. Shall I start\? Say yes or no\.$/i);
  assert.equal(d.answer('yes'), true);
  assert.equal(began[1].name, 'your home');
  assert.equal(began[1].lat, 51.01);
});

test('take me home with no GPS is spoken, not silent', async () => {
  const said = [];
  const d = new Dialogue({ say: (t) => said.push(t), nav: { getPosition: async () => { throw new Error('x'); } } });
  await d.navigateToSaved({ name: 'home', lat: 1, lon: 1 });
  assert.match(said.at(-1), /cannot find your location/);
});

// ---------------- battery ----------------
class Bat extends EventTarget { constructor(l, c = false) { super(); this.level = l; this.charging = c; } }
const set = (b, level) => { b.level = level; b.dispatchEvent(new Event('levelchange')); };

test('battery: each warning is spoken once as the charge falls, even when levels are skipped', async () => {
  const b = new Bat(0.5); const said = [];
  const w = new BatteryWatch({ getBattery: async () => b, say: (t, k) => said.push([t, k]) });
  assert.equal(await w.start(), true);
  for (const l of [0.45, 0.21, 0.2, 0.19, 0.15, 0.1, 0.09, 0.05, 0.04]) set(b, l);
  assert.deepEqual(said.map((x) => x[0]), ['Battery is at 20 percent.', 'Battery is low, 10 percent.', 'Battery is very low, 5 percent. Plug in soon.']);
  assert.equal(said[2][1], 'nav', 'the last warning is time-critical');
});

test('battery: a jump past several steps says one message, charging is silent and resets, starting low speaks at once', async () => {
  const b = new Bat(0.5); const said = [];
  const w = new BatteryWatch({ getBattery: async () => b, say: (t) => said.push(t) });
  await w.start(); set(b, 0.08);
  assert.equal(said.length, 1); assert.match(said[0], /low, 8 percent/);
  b.charging = true; b.dispatchEvent(new Event('chargingchange')); set(b, 0.07);
  assert.equal(said.length, 1, 'no warnings while charging');
  b.charging = false; b.dispatchEvent(new Event('chargingchange'));
  assert.equal(said.length, 2, 'after unplugging it is low again, so it says so');
  const low = new Bat(0.15); const said2 = [];
  await new BatteryWatch({ getBattery: async () => low, say: (t) => said2.push(t) }).start();
  assert.deepEqual(said2, ['Battery is at 15 percent.']);
});

test('battery: "what is my battery" answers, and an unsupported phone says so', async () => {
  const b = new Bat(0.63, true);
  const w = new BatteryWatch({ getBattery: async () => b, say() {} }); await w.start();
  assert.equal(w.ask(), 'Battery is at 63 percent and charging.');
  assert.equal(batteryText(0.07, false), 'Battery is low, 7 percent.');
  const none = new BatteryWatch({ say() {} });
  assert.equal(await none.start(), false);
  assert.match(none.ask(), /cannot read the battery/);
  const broken = new BatteryWatch({ getBattery: async () => { throw new Error('denied'); }, say() {} });
  assert.equal(await broken.start(), false);
});

test('battery voice commands', () => {
  for (const p of ['battery', 'what is my battery', 'how much charge is left', 'how much battery']) assert.equal(parseCommand(p).type, 'battery', p);
});

test('help text mentions the new commands', async () => {
  const { HELP_TEXT } = await import('../docs/js/commands.js');
  for (const w of ['in front of me', 'where am I', 'battery', 'take me home', 'steps']) assert.ok(HELP_TEXT.includes(w), w);
});
