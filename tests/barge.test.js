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

import { parseCommand } from '../docs/js/commands.js';
import { stepRate, RATES } from '../docs/js/speech.js';
test('speech speed, share my location and "I am lost" commands', () => {
  for (const p of ['slower', 'speak slower please', 'slow down', 'you are too fast']) assert.deepEqual(parseCommand(p), { type: 'rate', arg: 'slower' }, p);
  for (const p of ['faster', 'speak faster', 'speed up']) assert.deepEqual(parseCommand(p), { type: 'rate', arg: 'faster' }, p);
  for (const p of ['share my location', 'send my location', 'share where i am']) assert.equal(parseCommand(p).type, 'share', p);
  for (const p of ['i am lost', "i'm lost", 'help me i am lost']) assert.equal(parseCommand(p).type, 'lost', p);
  assert.equal(parseCommand('navigate to the lost property office').type, 'navigate', 'a place with "lost" in its name is still a destination');
});
test('speech speed steps one notch at a time and stops at the ends', () => {
  assert.equal(stepRate(0.8, -1), 0.7); assert.equal(stepRate(0.8, 1), 0.9);
  assert.equal(stepRate(RATES[0], -1), null); assert.equal(stepRate(RATES.at(-1), 1), null);
  assert.equal(stepRate(0.97, 1), 1.1, 'an odd saved value snaps to the nearest notch first');
});

test('the app\'s own "Already stopped. Say start" is never taken as the command "start", even a few words late', () => {
  const recent = ['already stopped. say start, or tap start.', 'nothing to repeat yet.'];
  for (const heard of ['say start or tap start', 'start', 'nothing to repeat yet', 'repeat', 'already stopped']) assert.equal(looksLikeEcho(heard, recent), true, heard);
  assert.equal(looksLikeEcho('where am i', recent), false, 'a real question is not an echo');
});

test('echo check uses whole words: "help" is not an echo of "this app helps"', () => {
  const said = ['ready. hold the phone at chest height, camera facing forward. keep using your cane or guide dog. this app helps, but does not replace them.'];
  assert.equal(looksLikeEcho('help', said), false);
  assert.equal(looksLikeEcho('battery', ['your battery is at 63 percent']), true, 'a real echo of a whole word is still caught');
  assert.equal(looksLikeEcho('star', ['start']), false);
});
