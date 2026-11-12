// Package A: crossings, limits, privacy and recording consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits } from '../docs/js/units.js';
import { parseCommand, HELP_TEXT } from '../docs/js/commands.js';
import { CROSSING_TEXT, LIMITS_TEXT } from '../docs/js/safetext.js';
import { selfCheckText } from '../docs/js/trustcheck.js';
import { firstStartPrivacy, PRIVACY_TEXT, RECORD_ASK, RecordingConsent } from '../docs/js/privacy.js';
import { Dialogue } from '../docs/js/dialogue.js';
import { Navigator, crossesRoad } from '../docs/js/nav.js';
import { AlertEngine } from '../docs/js/alerts.js';
import { CONFIG } from '../docs/js/config.js';
import { describeScene, findObject } from '../docs/js/describe.js';

test('crossing wording is the agreed line', () => {
  assert.equal(CROSSING_TEXT, "Crossing ahead. I can't read the traffic signal. Listen for traffic before you cross.");
});

test('questions about crossing and traffic lights all reach the crossing answer', () => {
  for (const q of ['is it safe to cross', 'Is the light green?', 'traffic light', 'is there a traffic light', 'can I cross now',
    'is the green man on', 'what colour are the traffic lights', 'crossing help']) assert.equal(parseCommand(q).type, 'cross', q);
  assert.equal(parseCommand('find a crossing').type, 'find', 'looking for a crossing is still object search');
});

test('limits: intent, answer, help and the full self-check', () => {
  for (const q of ["what can't you see", 'what cannot you see', 'what are your limits', 'what do you miss']) assert.equal(parseCommand(q).type, 'limits', q);
  assert.equal(LIMITS_TEXT, "I can't reliably see kerbs, drops, potholes, low branches, ice, or traffic signals. Keep using your cane or guide dog.");
  assert.match(HELP_TEXT, /what can't you see/);
  const ok = { camera: true, location: true, internet: true, listening: true };
  assert.ok(selfCheckText(ok, true).endsWith(LIMITS_TEXT), 'asked "are you working?": limits follow');
  assert.ok(selfCheckText({ ...ok, internet: false }, true).endsWith(LIMITS_TEXT));
  assert.equal(selfCheckText(ok), '', 'a normal start stays quiet when all is well');
  assert.ok(!selfCheckText({ ...ok, internet: false }).includes(LIMITS_TEXT), 'only problems on a normal start');
});

const fakeStorage = () => { const m = {}; return { m, getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); } }; };

test('privacy line: once on the first ever start, then never again; "privacy" asks for it', () => {
  const st = fakeStorage();
  assert.equal(firstStartPrivacy(st), PRIVACY_TEXT);
  assert.equal(firstStartPrivacy(st), '');
  assert.equal(firstStartPrivacy(st), '');
  assert.equal(PRIVACY_TEXT, 'Your voice and route searches go to Google so I can understand you and find routes. Camera pictures stay on this phone, except one photo sent to Google when you say read or describe this. Recording a session stays on this phone.');
  for (const q of ['privacy', 'what do you send', 'where does my data go', 'is this private']) assert.equal(parseCommand(q).type, 'privacy', q);
});

test('privacy line: storage that is missing or throws still gets it said', () => {
  assert.equal(firstStartPrivacy(null), PRIVACY_TEXT);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(firstStartPrivacy(broken), PRIVACY_TEXT);
  assert.equal(firstStartPrivacy(broken), PRIVACY_TEXT);
});

function dialogue() {
  const said = []; const prompts = [];
  const d = new Dialogue({ say: (t) => said.push(t), nav: {}, onPrompt: (o) => prompts.push(o), timeoutMs: 20 });
  return { d, said, prompts };
}

test('recording starts only after a yes, and consent lasts for the page session', () => {
  const { d, said, prompts } = dialogue();
  const c = new RecordingConsent();
  let started = 0, refused = 0;
  const ask = (q, y, n) => d.confirm(q, y, n);
  assert.equal(c.request(ask, () => started++, () => refused++), false);
  assert.equal(said.at(-1), RECORD_ASK);
  assert.equal(RECORD_ASK, 'Recording saves video and a log on this phone. Say yes to start, or no.');
  assert.deepEqual(prompts.at(-1).map((o) => o.value), ['yes', 'no'], 'yes and no buttons are shown');
  assert.equal(started, 0, 'nothing before the answer');
  assert.equal(d.answer('yes'), true);
  assert.equal(started, 1); assert.equal(c.granted, true);
  assert.equal(c.request(ask, () => started++), true, 'asked once per session');
  assert.equal(started, 2);
  assert.equal(new RecordingConsent().granted, false, 'a new page session asks again');
});

test('no, mumbling twice, or silence all mean no', async () => {
  for (const answers of [['no'], ['banana', 'potato']]) {
    const { d } = dialogue(); const c = new RecordingConsent(); let started = 0, refused = 0;
    c.request((q, y, n) => d.confirm(q, y, n), () => started++, () => refused++);
    for (const a of answers) d.answer(a);
    assert.deepEqual([started, refused, c.granted, d.waiting], [0, 1, false, false], answers.join());
  }
  const { d, said } = dialogue(); const c = new RecordingConsent(); let refused = 0;
  c.request((q, y, n) => d.confirm(q, y, n), () => assert.fail('must not start'), () => refused++);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(refused, 1); assert.match(said.at(-1), /taken that as no/);
});

test('crossesRoad: Google instructions, OSRM names and intersection classes', () => {
  assert.ok(crossesRoad({ text: 'cross the road' }));
  assert.ok(crossesRoad({ text: 'turn left, then take the crosswalk' }));
  assert.ok(crossesRoad({ name: 'Park Street crossing' }));
  assert.ok(crossesRoad({ text: 'continue', intersections: [{ classes: ['crossing'] }] }));
  assert.ok(!crossesRoad({ text: 'turn left onto Crossways Lane' }), 'a street name that only starts with "cross" is not a crossing');
  assert.ok(!crossesRoad({ text: 'turn right onto High Street' }));
  assert.ok(!crossesRoad(null));
});

test('a route step that crosses a road gets the crossing line, once', async () => {
  setUnits('metres');
  const said = []; let cb;
  const route = { distance: 220, duration: 180, source: 'google', steps: [
    { distance: 110, text: 'walk ahead', maneuver: { type: 'depart' }, at: { lat: 51, lon: 0 }, path: [{ lat: 51, lon: 0 }, { lat: 51, lon: 0.0015 }] },
    { distance: 110, text: 'cross the road, then turn left', maneuver: { type: 'turn' }, at: { lat: 51, lon: 0.0015 }, path: [{ lat: 51, lon: 0.0015 }, { lat: 51.001, lon: 0.0015 }] },
    { distance: 0, text: 'you have arrived', maneuver: { type: 'arrive' }, at: { lat: 51.001, lon: 0.0015 }, path: [] },
  ] };
  const nav = new Navigator({ say: (t) => said.push(t), providers: { route: async () => route }, getPosition: async () => ({ lat: 51, lon: 0 }), watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
  nav.begin({ lat: 51, lon: 0 }, { name: 'Dest', lat: 51.001, lon: 0.0015 }, route, true, false);
  cb({ lat: 51, lon: 0.0010, accuracy: 10 });
  assert.ok(said.at(-1).endsWith(CROSSING_TEXT), said.at(-1));
  cb({ lat: 51, lon: 0.00145, accuracy: 10 });
  assert.match(said.at(-1), /now\.$/, 'the "now" prompt does not repeat it');
  assert.equal(said.filter((s) => s.includes(CROSSING_TEXT)).length, 1);
});

test('green lights are never announced or described by colour', () => {
  const tr = { id: 1, cls: 2, name: 'green_light', hits: 5, dist: null, speed: null, box: { x1: 300, y1: 100, x2: 340, y2: 200 } };
  const e = new AlertEngine(CONFIG, 'detailed');
  assert.equal(e.next([tr], 640, 480, 0), null);
  assert.doesNotMatch(describeScene([tr], 640), /green/i);
  assert.doesNotMatch(findObject([tr], 'traffic light', 640), /green/i);
});
