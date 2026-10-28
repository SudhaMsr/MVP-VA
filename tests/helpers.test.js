import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits, getUnits, roundDistance, nearDistance, durationPhrase, DEFAULT_UNITS, DEFAULT_STEP_METRES, getStep, setStep, stepCm } from '../docs/js/units.js';
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
test('miles is the default, with yards for short distances and simple fractions for long ones', () => {
  assert.equal(DEFAULT_UNITS, 'miles');
  assert.equal(getUnits(), 'miles');
  const say = (m) => roundDistance(m);
  assert.equal(say(8), 'a few yards');
  assert.equal(say(36), '40 yards');
  assert.equal(say(150), '150 yards');
  assert.equal(say(260), '300 yards');
  assert.equal(say(500), '0.3 miles');
  assert.equal(say(800), '0.5 miles');
  assert.equal(say(1118), '0.7 miles'); // the real Queen Square to Temple Meads walk
  assert.equal(say(1609), '1 mile');
  assert.equal(say(2000), '1.2 miles');
  assert.equal(say(4000), '2.5 miles');
  assert.equal(say(16100), '10 miles');
  assert.equal(nearDistance(1), 'very close');
  assert.equal(nearDistance(2), 'about 2 yards');
  assert.equal(nearDistance(3.4), 'about 4 yards');
});

test('metres mode: metres and simple kilometres', () => {
  setUnits('metres');
  try {
    assert.equal(roundDistance(8), 'a few metres');
    assert.equal(roundDistance(43), '40 metres');
    assert.equal(roundDistance(260), '250 metres');
    assert.equal(roundDistance(1118), '1.1 kilometres');
    assert.equal(roundDistance(1700), '1.7 kilometres');
    assert.equal(roundDistance(2700), '2.7 kilometres');
    assert.equal(nearDistance(2), 'about 2 metres');
  } finally { setUnits('miles'); }
});

test('steps: use the walker\'s step length, round simply, and give way to miles for long distances', () => {
  setUnits('steps');
  try {
    assert.equal(DEFAULT_STEP_METRES, 0.7);
    assert.equal(getStep(), 0.7);
    assert.equal(roundDistance(3), 'a few steps');
    assert.equal(roundDistance(14), '20 steps');
    assert.equal(roundDistance(40), '60 steps'); // 57 steps
    assert.equal(roundDistance(100), '150 steps'); // 143 steps
    assert.equal(roundDistance(400), '600 steps'); // 571 steps
    assert.equal(roundDistance(1118), '0.7 miles', 'nobody counts 1600 steps');
    assert.equal(nearDistance(1), 'very close');
    assert.equal(nearDistance(2), 'about 3 steps');
    assert.equal(roundMetres(40), '60 steps', 'navigation uses the same setting');
    assert.equal(setUnits('furlongs'), 'steps', 'unknown modes are ignored');
  } finally { setUnits('miles'); }
});

test('a walker can set their own step length; absurd values are refused and change nothing', () => {
  setUnits('steps');
  try {
    assert.equal(setStep(0.6), 0.6); assert.equal(stepCm(), 60);
    assert.equal(roundDistance(40), '70 steps'); // 40 / 0.6 = 67
    assert.equal(nearDistance(2.4), 'about 4 steps');
    assert.equal(setStep(0.05), null); assert.equal(setStep(2), null); assert.equal(setStep(NaN), null);
    assert.equal(getStep(), 0.6, 'a refused value changes nothing');
  } finally { setStep(0.7); setUnits('miles'); }
});

test('journey times are rounded so they are easy to take in', () => {
  assert.equal(durationPhrase(20), 'about 1 minute');
  assert.equal(durationPhrase(480), 'about 8 minutes');
  assert.equal(durationPhrase(955), 'about 15 minutes'); // 16 minutes in the data
  assert.equal(durationPhrase(1500), 'about 25 minutes');
  assert.equal(durationPhrase(3600), 'about an hour');
  assert.equal(durationPhrase(4500), 'about an hour and a quarter');
  assert.equal(durationPhrase(7200), 'about 2 hours');
});

test('hazard alerts and navigation prompts speak in the chosen unit', () => {
  const idx = (n) => CLASSES.indexOf(n);
  const person = [{ id: 1, cls: idx('person'), name: 'person', hits: 5, dist: 2.1, speed: 0, box: { x1: 280, y1: 200, x2: 360, y2: 300 } }];
  const alert = () => new AlertEngine(CONFIG, 'normal').next(person, 640, 480, 0).text;
  assert.match(alert(), /Person, ahead, about 2 yards\./);
  setUnits('steps'); try { assert.match(alert(), /about 3 steps\./); } finally { setUnits('miles'); }
  setUnits('metres'); try { assert.match(alert(), /about 2 metres\./); } finally { setUnits('miles'); }
});

test('units voice commands: miles, metres, steps', () => {
  for (const p of ['use steps', 'switch to steps', 'distances in steps', 'give me steps', 'count in steps']) assert.deepEqual(parseCommand(p), { type: 'units', arg: 'steps' }, p);
  for (const p of ['use metres', 'switch to meters', 'distances in metres', 'give me metres']) assert.deepEqual(parseCommand(p), { type: 'units', arg: 'metres' }, p);
  for (const p of ['use miles', 'switch to miles', 'distances in miles', 'use yards', 'give me yards', 'use imperial']) assert.deepEqual(parseCommand(p), { type: 'units', arg: 'miles' }, p);
});

test('step length voice commands', () => {
  assert.deepEqual(parseCommand('my step is 60 centimetres'), { type: 'stepLength', arg: 0.6 });
  assert.deepEqual(parseCommand('set my step length to 2 feet'), { type: 'stepLength', arg: 0.6096 });
  assert.deepEqual(parseCommand('my steps are 0.65 metres'), { type: 'stepLength', arg: 0.65 });
  assert.deepEqual(parseCommand('my stride is 24 inches'), { type: 'stepLength', arg: 0.6096 });
  assert.deepEqual(parseCommand('set step length to two feet'), { type: 'stepLength', arg: 0.6096 });
  assert.deepEqual(parseCommand('my steps are shorter'), { type: 'stepLength', arg: 'shorter' });
  assert.deepEqual(parseCommand('make my steps longer'), { type: 'stepLength', arg: 'longer' });
  assert.equal(parseCommand('use steps').type, 'units', 'plain "use steps" is still a unit change');
});

// ---------------- what is in front of me ----------------
test('scene description groups, orders by side and names distances', () => {
  const s = describeScene([T('bus', 2, 280), T('person', 3, 290), T('person', 2.5, 300), T('person', 2, 500), T('ashcan', 1.2, 20)], W);
  assert.match(s, /^Straight ahead: a bus, about 2 yards; and 2 people, about 3 yards\./);
  assert.match(s, /On your left: a bin, very close\./);
  assert.match(s, /On your right: a person, about 2 yards\./);
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
  setUnits('steps'); try { assert.match(describeScene([T('person', 2.1, 300)], W), /about 3 steps/); } finally { setUnits('miles'); }
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

test('take me home: a saved place starts straight away', async () => {
  const said = []; let began = null;
  const route = { distance: 800, duration: 600, steps: [{ text: 'walk ahead', distance: 800 }] };
  const nav = { getPosition: async () => ({ lat: 51, lon: -2 }), plan: async () => route, begin: (...a) => { began = a; }, active: false };
  const d = new Dialogue({ say: (t) => said.push(t), nav });
  await d.navigateToSaved({ name: 'home', lat: 51.01, lon: -2 });
  assert.equal(began[1].name, 'your home');
  assert.equal(began[1].lat, 51.01);
  assert.equal(d.waiting, false);
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
  assert.ok(said.every((x) => x[1] === 'status'), 'all in the same queue, so they are spoken in order');
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

test('"save my home address as ..." saves the ADDRESS, never the current position', () => {
  assert.deepEqual(parseCommand('save my home address as 25 Lakeside, BS16 3EE'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('save my home address as 25 Lakeside BS16 3EE please'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('set my home to 25 lakeside bs16 3ee'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('my home address is 25 Lakeside BS16 3EE'), { type: 'saveAddress', name: 'home', arg: '25 lakeside bs16 3ee' });
  assert.deepEqual(parseCommand('save my work address as 1 high street bristol'), { type: 'saveAddress', name: 'work', arg: '1 high street bristol' });
  assert.deepEqual(parseCommand('save my mums address as 4 mill lane bath'), { type: 'saveAddress', name: 'mums', arg: '4 mill lane bath' });
  // and the here-versions still mean "where I am now"
  assert.deepEqual(parseCommand('save my home'), { type: 'save', arg: 'home' });
  assert.deepEqual(parseCommand('save this place as home'), { type: 'save', arg: 'home' });
  assert.deepEqual(parseCommand('this is home'), { type: 'save', arg: 'home' });
  // unit and step commands are not mistaken for addresses
  assert.equal(parseCommand('set distances to miles').type, 'units');
  assert.equal(parseCommand('set my step length to 2 feet').type, 'stepLength');
  assert.equal(parseCommand('change to metres').type, 'units');
});

// ---------------- save an address ----------------
function addressSetup(found, opts = {}) {
  const said = []; const mem = {};
  const places = new PlaceStore({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } });
  const nav = { getPosition: async () => { throw new Error('no gps'); }, lookup: async () => found };
  const d = new Dialogue({ say: (t) => said.push(t), nav, places, ...opts });
  return { d, said, places };
}
const FOUND = { lat: 51.5, lon: -2.55, name: '25 Lakeside', address: '25 Lakeside, Bristol BS16 3EE, UK' };

test('an address is read back and saved only after the walker says yes', async () => {
  const { d, said, places } = addressSetup(FOUND);
  await d.saveAddress('home', '25 lakeside bs16 3ee');
  assert.match(said.at(-1), /^I found 25 Lakeside, Bristol BS16 3EE\. Save it as home\? Say yes or no\.$/);
  assert.equal(places.get('home'), null, 'nothing is saved before the yes');
  assert.equal(d.answer('yes'), true);
  assert.match(said.at(-1), /^Saved as home\. To come back, say take me home\./);
  const h = places.get('home');
  assert.equal(h.lat, 51.5); assert.equal(h.address, '25 Lakeside, Bristol BS16 3EE');
});

test('saying no (or nothing clear) does not save the address', async () => {
  const { d, said, places } = addressSetup(FOUND);
  await d.saveAddress('home', '25 lakeside bs16 3ee');
  assert.equal(d.answer('no'), true);
  assert.match(said.at(-1), /have not saved it/);
  assert.equal(places.get('home'), null);
  await d.saveAddress('home', '25 lakeside bs16 3ee');
  d.answer('banana'); assert.match(said.at(-1), /Please say yes or no/);
  d.answer('banana'); assert.match(said.at(-1), /cancelled/);
  assert.equal(places.get('home'), null);
});

test('a mis-heard postcode is called out before saving', async () => {
  const { d, said } = addressSetup({ ...FOUND, address: '25 Lakeside, Bristol BS16 9XY, UK' });
  await d.saveAddress('home', '25 lakeside bs16 3ee');
  assert.match(said.at(-1), /different postcode from the one you gave, so please check it\. Save it as home\?/);
  const none = addressSetup({ ...FOUND, address: '25 Lakeside, Bristol' });
  await none.d.saveAddress('home', '25 lakeside bs16 3ee');
  assert.match(none.said.at(-1), /I could not check the postcode/);
  const plain = addressSetup({ ...FOUND, address: '25 Lakeside, Bristol' });
  await plain.d.saveAddress('home', '25 lakeside bristol');
  assert.doesNotMatch(plain.said.at(-1), /postcode/);
});

test('address not found, lookup failing, and storage failing are all spoken', async () => {
  const a = addressSetup(null); await a.d.saveAddress('home', 'nowhere');
  assert.match(a.said.at(-1), /could not find nowhere/);
  const b = addressSetup(FOUND); b.d.nav.lookup = async () => { throw new Error('offline'); };
  await b.d.saveAddress('home', 'x'); assert.match(b.said.at(-1), /Check your internet connection/);
  const c = addressSetup(FOUND); c.d.places = new PlaceStore({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  await c.d.saveAddress('home', '25 lakeside'); c.d.answer('yes');
  assert.match(c.said.at(-1), /only remember it until you close the page/);
});

test('the answer window is long enough for a walker to reply (40 seconds)', () => {
  assert.equal(new Dialogue({ say() {}, nav: {} }).timeoutMs, 40000);
});
