import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres'); // these tests check the metres wording; miles is the app default
import assert from 'node:assert/strict';
import { Dialogue, parseAnswer } from '../docs/js/dialogue.js';

test('answers are understood', () => {
  assert.equal(parseAnswer('Yes please').type, 'yes');
  assert.equal(parseAnswer('go ahead').type, 'yes');
  assert.equal(parseAnswer('no').type, 'no');
  assert.equal(parseAnswer('never mind').type, 'no');
  assert.equal(parseAnswer('number two').n, 2);
  assert.equal(parseAnswer('the first one').n, 1);
  assert.equal(parseAnswer('banana').type, null);
});

const route = { distance: 1500, duration: 1200, steps: [{ text: 'walk along Park Row' }, { text: 'turn left onto Queens Road' }] };
function setup(results) {
  const said = [], calls = [], prompts = [];
  const nav = {
    active: false,
    find: async () => ({ pos: { lat: 1, lon: 1 }, results }),
    plan: async () => route,
    begin: (...a) => { calls.push(a); return true; },
  };
  const d = new Dialogue({ say: (t) => said.push(t), nav, onPrompt: (o) => prompts.push(o), timeoutMs: 50 });
  return { d, said, calls, prompts };
}
const A = { name: 'Tesco, Gloucester Road', lat: 1, lon: 1 };
const B = { name: 'Tesco Express, Cheltenham Road', lat: 2, lon: 2 };

test('goes straight to the best match, with no questions', async () => {
  const { d, said, calls } = setup([A, B]);
  await d.navigateTo('tesco');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].name, A.name);
  assert.equal(calls[0][4], false); // full start message: place, distance, time
  assert.equal(d.waiting, false);
  assert.doesNotMatch(said.join(' '), /Shall I start|I found \d places/);
});

test('nothing is said twice when navigating', async () => {
  const { d, said } = setup([A, B]);
  await d.navigateTo('tesco');
  assert.equal(new Set(said).size, said.length);
});

test('words are ignored when nothing was asked', () => {
  const { d } = setup([A]);
  assert.equal(d.answer('yes'), false);
});

test('stairs on the route are mentioned in the start message', async () => {
  const { Navigator } = await import('../docs/js/nav.js');
  const said = [];
  const st = [
    { distance: 400, text: 'walk ahead', maneuver: { type: 'depart', location: [0, 51] }, at: { lat: 51, lon: 0 }, path: [] },
    { distance: 10, text: 'turn right, then take the stairs', maneuver: { type: 'turn', location: [0.003, 51] }, at: { lat: 51, lon: 0.003 }, path: [] },
    { distance: 0, text: 'you have arrived', maneuver: { type: 'arrive', location: [0.004, 51] }, at: { lat: 51, lon: 0.004 }, path: [] },
  ];
  const r = { distance: 410, duration: 300, steps: st, source: 'x' };
  const nav = new Navigator({ say: (t) => said.push(t), providers: { route: async () => r }, getPosition: async () => ({ lat: 51, lon: 0 }), watch: () => 1, unwatch: () => {} });
  nav.begin({ lat: 51, lon: 0 }, { name: 'Cafe', lat: 51, lon: 0.004 }, r, true, false);
  assert.match(said.at(-1), /The route includes stairs\./);
});

test('after the walker says yes, the start message is short', async () => {
  const { Navigator } = await import('../docs/js/nav.js');
  const said = [];
  const st = [
    { distance: 400, text: 'walk along Mill Lane', maneuver: { type: 'depart', location: [0, 51] }, at: { lat: 51, lon: 0 }, path: [] },
    { distance: 0, text: 'you have arrived', maneuver: { type: 'arrive', location: [0.004, 51] }, at: { lat: 51, lon: 0.004 }, path: [] },
  ];
  const nav = new Navigator({ say: (t) => said.push(t), providers: { route: async () => ({ distance: 400, duration: 300, steps: st, source: 'x' }) }, getPosition: async () => ({ lat: 51, lon: 0 }), watch: () => 1, unwatch: () => {} });
  nav.begin({ lat: 51, lon: 0 }, { name: 'Cafe', lat: 51, lon: 0.004 }, { distance: 400, duration: 300, steps: st, source: 'x' }, true, true);
  assert.equal(said.at(-1), 'Starting. Walk along Mill Lane for 400 metres. I will tell you if you need to turn.');
});

test('asking to go somewhere you already are says so, instead of "NaN miles"', async () => {
  const said = [];
  const nav = { getPosition: async () => ({ lat: 51.45, lon: -2.58 }), plan: async () => ({ distance: 0, duration: 0, steps: [] }) };
  const { Dialogue } = await import('../docs/js/dialogue.js');
  const dlg = new Dialogue({ say: (t) => said.push(t), nav, onPrompt: () => {} });
  await dlg.navigateToSaved({ name: 'work', lat: 51.45002, lon: -2.58001 });
  assert.match(said[0], /already at your work/);
  assert.doesNotMatch(said.join(' '), /NaN/);
});
