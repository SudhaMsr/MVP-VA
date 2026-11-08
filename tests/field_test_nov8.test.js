// Field test, 8 Nov: fixes from the first walk on the Poco.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setUnits } from '../docs/js/units.js';
import { Navigator, cleanStreetNames, plainWords, instructionText, MAX_WALK_M } from '../docs/js/nav.js';
import { Dialogue } from '../docs/js/dialogue.js';
import { findObject, objectNames } from '../docs/js/describe.js';
import { HAZARD, hazardOnByDefault } from '../docs/js/config.js';

const c = (t) => cleanStreetNames(plainWords(t));

test('directions never speak street or place names', () => {
  assert.equal(c('Head north on Church Rd toward Southey Ave'), 'walk straight');
  assert.equal(c('Turn left onto High Street'), 'Turn left');
  assert.equal(c('Turn right to stay on Church Rd'), 'Turn right');
  assert.equal(c('Turn slightly left toward Park Street'), 'keep left');
  assert.equal(c('Turn left at Tesco'), 'Turn left');
  assert.equal(c('Continue onto Mill Lane'), 'continue straight');
  assert.equal(c('Walk through Castle Park'), 'walk straight');
  assert.equal(c('Turn right (signs for Cabot Circus)'), 'Turn right');
  assert.equal(cleanStreetNames('turn left onto High Street, then pass by Tesco (on the left)'), 'turn left');
  assert.equal(instructionText({ text: 'walk along Church Rd towards Southey Ave' }), 'walk straight');
  assert.equal(instructionText({ name: 'Church Rd', maneuver: { type: 'depart' } }), 'walk straight');
  assert.equal(instructionText({ name: 'Mill Lane', maneuver: { type: 'roundabout', exit: 2 } }), 'at the roundabout, take exit 2');
});

test('where-words that help a blind walker are kept', () => {
  assert.equal(c('Destination will be on the right'), 'Destination will be on the right');
  assert.equal(c('Take the stairs'), 'Take the stairs');
  assert.equal(c('Cross the road'), 'Cross the road');
  assert.equal(c('At the roundabout, take the 2nd exit onto Mill Lane'), 'At the roundabout, take the 2nd exit');
  assert.equal(c('Turn left at the end of the road'), 'Turn left at the end of the road');
});

function startMessage(steps, distance = 4000) {
  const said = [];
  const r = { distance, duration: 3000, steps, source: 'x' };
  const nav = new Navigator({ say: (t) => said.push(t), providers: { route: async () => r }, getPosition: async () => ({ lat: 51, lon: 0 }), watch: () => 1, unwatch: () => {} });
  nav.begin({ lat: 51, lon: 0 }, { name: '25 Lakeside', lat: 51, lon: 0.004 }, r, true, false);
  return said;
}

test('the start message gives the time and the first direction, with no crossing line and no street names', () => {
  setUnits('steps');
  const said = startMessage([
    { distance: 18, text: 'walk along Church Rd towards Southey Ave', maneuver: { type: 'depart', location: [0, 51] }, at: { lat: 51, lon: 0 }, path: [] },
    { distance: 0, text: 'your destination', maneuver: { type: 'arrive', location: [0.004, 51] }, at: { lat: 51, lon: 0.004 }, path: [] },
  ]);
  assert.equal(said[0], 'Going to 25 Lakeside. About 50 minutes. First, walk straight for 25 steps.');
  assert.doesNotMatch(said.join(' '), /crossing|Church|Southey/i);
});

test('a road crossing is still warned about when the walker reaches it', () => {
  const said = startMessage([
    { distance: 30, text: 'cross the road', maneuver: { type: 'depart', location: [0, 51] }, at: { lat: 51, lon: 0 }, path: [] },
    { distance: 0, text: 'your destination', maneuver: { type: 'arrive', location: [0.004, 51] }, at: { lat: 51, lon: 0.004 }, path: [] },
  ]);
  assert.match(said.join(' '), /I can't read the traffic signal/);
});

function dialogueWith(route) {
  const said = [], calls = [];
  const nav = { active: false, find: async () => ({ pos: { lat: 51.48, lon: -2.52 }, results: [{ name: 'Lakeside Shopping Centre, W Thurrock Way', lat: 51.49, lon: 0.28 }] }), plan: async () => route, begin: (...a) => calls.push(a) };
  return { d: new Dialogue({ say: (t) => said.push(t), nav, onPrompt: () => {}, timeoutMs: 50 }), said, calls };
}

test('a place too far to walk is not started, and the walker is asked for the postcode', async () => {
  setUnits('steps');
  const { d, said, calls } = dialogueWith({ distance: 230000, duration: 176000, steps: [{ text: 'walk' }] });
  await d.navigateTo('lakeside');
  assert.equal(calls.length, 0, 'no route started');
  assert.match(said.at(-1), /too far to walk, so I have not started\. Say the address with the postcode/);
  assert.match(said.at(-1), /miles away/);
});

test('a place within walking distance still starts at once', async () => {
  const { d, calls } = dialogueWith({ distance: MAX_WALK_M - 1, duration: 7000, steps: [{ text: 'walk' }] });
  await d.navigateTo('lakeside');
  assert.equal(calls.length, 1);
});

test('"are there cars in front of me" looks for cars', () => {
  assert.deepEqual(objectNames('cars in front of me'), ['car']);
  assert.deepEqual(objectNames('a bench near me'), ['bench']);
  assert.deepEqual(objectNames('any people ahead'), objectNames('people'));
  assert.deepEqual(objectNames('a bin on my left'), objectNames('bin'));
  const tracks = [{ name: 'car', hits: 3, dist: 6, box: { x1: 280, x2: 360 }, x1: 280, x2: 360 }];
  assert.doesNotMatch(findObject(tracks, 'cars in front of me', 640), /cannot recognise/);
  assert.doesNotMatch(findObject([], 'cars in front of me', 640), /cannot recognise/);
});

test('the hazard lane does not run by default while it speaks nothing (it held up live detection)', () => {
  assert.equal(HAZARD.speakClasses.length, 0);
  assert.equal(hazardOnByDefault(HAZARD), false);
  assert.equal(hazardOnByDefault({ speakClasses: ['e_scooter'] }), true, 'it comes back on by itself once a class graduates');
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(!hazardDetector && hazardWanted\(\)\)/);
  assert.match(app, /params\.get\('hazard'\) === 'on'/);
});
