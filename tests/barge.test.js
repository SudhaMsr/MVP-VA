import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import { looksLikeEcho, isBargeIn, wordsOf } from '../docs/js/barge.js';
import { parseAnswer, shortName, Dialogue } from '../docs/js/dialogue.js';
import { Speaker } from '../docs/js/speech.js';

const said = ['i found 3 places. one, puregym, bond street. two, puregym, broadmead. three, the gym group, castle park. say one, two or three.'];

test('the app hearing its own words is an echo', () => {
  assert.equal(looksLikeEcho('puregym bond street', said), true);
  assert.equal(looksLikeEcho('say one two or three', said), true);
  assert.equal(looksLikeEcho('take me to tesco', said), false);
  assert.equal(looksLikeEcho('', said), true);
});

test('talking over the app: new words, a command or an answer cut it off; its own words and one odd word do not', () => {
  assert.equal(isBargeIn('puregym bond street', said), false, 'that is just the app');
  assert.equal(isBargeIn('puregym bund street', said), false, 'one mis-heard word of its own voice');
  assert.equal(isBargeIn('actually take me home', said), true, 'new words');
  assert.equal(isBargeIn('stop', said, { isCommand: true }), true);
  assert.equal(isBargeIn('one', said, { isAnswer: true }), true, 'answering while it is still reading the list');
  assert.equal(isBargeIn('um the', said), false);
  assert.deepEqual(wordsOf('Hello, World 2!'), ['hello', 'world', '2']);
});

test('answers, including repeat and digits', () => {
  assert.deepEqual(parseAnswer('1'), { type: 'choice', n: 1 });
  assert.deepEqual(parseAnswer('number two'), { type: 'choice', n: 2 });
  assert.deepEqual(parseAnswer('repeat that'), { type: 'repeat' });
  assert.deepEqual(parseAnswer('say that again'), { type: 'repeat' });
});

test('list wording is the name and street only', () => {
  assert.equal(shortName({ name: 'PureGym Bristol Bond Street', address: 'Bond Street, Bristol BS1 3LE, UK' }), 'PureGym Bristol Bond Street, Bond Street');
  assert.equal(shortName({ name: 'M Shed, Princes Wharf', address: 'Princes Wharf, Wapping Rd, Bristol BS1 4RN, UK' }), 'M Shed, Princes Wharf');
  assert.equal(shortName({ name: 'Cabot Circus', address: '1 Bond St S, Bristol BS1 3BD' }), 'Cabot Circus, Bristol');
});

function fake() {
  const spoken = [], cancelled = []; let last = null;
  const synth = { speak: (u) => { last = u; spoken.push(u.text); }, cancel: () => cancelled.push(1) };
  const sp = new Speaker(synth, function (t) { this.text = t; }, { setTimer: () => 0, clearTimer: () => {} });
  return { sp, spoken, cancelled, finish: () => last && last.onend && last.onend() };
}

test('skip stops reading a question out and never comes back to it, but keeps turn prompts and urgent warnings', () => {
  const { sp, spoken, cancelled, finish } = fake();
  sp.speak('I found 3 places. One, A. Two, B.', 'status'); // playing
  sp.speak('More status.', 'status'); sp.speak('Turn left now.', 'nav');
  sp.skip();
  assert.equal(cancelled.length, 1);
  assert.equal(spoken.at(-1), 'Turn left now.', 'the turn prompt goes on');
  finish();
  assert.ok(!spoken.includes('More status.'));
  const f = fake(); f.sp.speak('Danger, car.', 'urgent'); f.sp.skip();
  assert.equal(f.cancelled.length, 0, 'an urgent warning is never cut off');
});

test('while choosing, "repeat" reads the list again and answering during it works', async () => {
  const said = [];
  const nav = { getPosition: async () => ({ lat: 51.45, lon: -2.58 }), find: async () => ({ pos: { lat: 51.45, lon: -2.58 }, results: [
    { name: 'PureGym Bond Street', address: 'Bond Street, Bristol', lat: 51.46, lon: -2.58 }, { name: 'PureGym Broadmead', address: 'Broadmead, Bristol', lat: 51.46, lon: -2.59 }] }),
    plan: async () => ({ distance: 600, duration: 450, steps: [] }) };
  const dlg = new Dialogue({ say: (t) => said.push(t), nav, onPrompt: () => {} });
  await dlg.navigateTo('puregym');
  assert.match(said.at(-1), /^I found 2 places\. One, PureGym Bond Street, Bond Street\. Two, PureGym Broadmead, Broadmead\. Say one, two or three\.$/);
  const list = said.at(-1);
  assert.equal(dlg.answer('repeat'), true); assert.equal(said.at(-1), list);
  assert.equal(dlg.answer('1'), true); await new Promise((r) => setTimeout(r, 5));
  assert.match(said.at(-1), /^Number 1\. PureGym Bond Street\. 600 metres, about 8 minutes\. Shall I start\? Say yes or no\.$/);
  assert.equal(dlg.answer('repeat'), true); assert.match(said.at(-1), /^Number 1\./, 'repeat works for the yes/no question too');
  dlg.cancel();
});
