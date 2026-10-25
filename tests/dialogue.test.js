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

test('one match: tells distance, waits for yes, then starts', async () => {
  const { d, said, calls } = setup([A]);
  await d.navigateTo('tesco');
  assert.match(said.at(-1), /^Tesco, Gloucester Road\. /);
  assert.match(said.at(-1), /Shall I start\?/);
  assert.equal(calls.length, 0);
  assert.equal(d.answer('yes'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].name, A.name);
  assert.equal(d.waiting, false);
});

test('several matches: asks which, then confirms the chosen one', async () => {
  const { d, said, calls } = setup([A, B]);
  await d.navigateTo('tesco');
  assert.match(said.at(-1), /I found 2 places\. One, Tesco, Gloucester Road\. Two, Tesco Express/);
  assert.equal(d.state, 'choose');
  d.answer('two');
  await new Promise((r) => setTimeout(r, 5));
  assert.match(said.at(-1), /Tesco Express, Cheltenham Road/);
  assert.equal(d.state, 'confirm');
  d.answer('yes');
  assert.equal(calls[0][1].name, B.name);
});

test('no cancels; misheard twice cancels; timeout cancels', async () => {
  let s = setup([A]); await s.d.navigateTo('x'); s.d.answer('no');
  assert.equal(s.said.at(-1), 'Okay, cancelled.'); assert.equal(s.d.waiting, false);

  s = setup([A]); await s.d.navigateTo('x');
  s.d.answer('banana'); assert.equal(s.said.at(-1), 'Please say yes or no.');
  s.d.answer('mango'); assert.match(s.said.at(-1), /cancelled/); assert.equal(s.d.waiting, false);

  s = setup([A]); await s.d.navigateTo('x');
  await new Promise((r) => setTimeout(r, 90));
  assert.match(s.said.at(-1), /I will cancel that/); assert.equal(s.d.waiting, false);
});

test('words are ignored when nothing was asked', () => {
  const { d } = setup([A]);
  assert.equal(d.answer('yes'), false);
});

test('duplicate names collapse to one question', async () => {
  const { d, said } = setup([A, { ...A }]);
  await d.navigateTo('tesco');
  assert.match(said.at(-1), /Shall I start\?/);
});

test('stairs on the route are mentioned', async () => {
  const s = setup([A]);
  s.d.nav.plan = async () => ({ ...route, steps: [{ text: 'walk ahead' }, { text: 'turn right, then take the stairs' }] });
  await s.d.navigateTo('x');
  assert.match(s.said.at(-1), /The route includes stairs\./);
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
