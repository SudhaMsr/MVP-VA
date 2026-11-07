import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteStore, crossingAdvice } from '../docs/js/notes.js';
import { parseCommand } from '../docs/js/commands.js';
const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } }; };
test('notes: add, find newest first, list', () => {
  const n = new NoteStore(mem());
  n.add('I put my keys in the drawer.'); n.add('my keys are now in the coat');
  assert.equal(n.find('my keys')[0].text, 'my keys are now in the coat');
  assert.equal(n.find('passport').length, 0);
  assert.equal(n.list().length, 2); assert.equal(n.add('  '), null);
});
test('crossing advice never reads a signal colour and never says safe (Package A)', () => {
  const t = (name, dist) => ({ name, hits: 3, dist });
  const line = "Crossing ahead. I can't read the traffic signal. Listen for traffic before you cross.";
  assert.equal(crossingAdvice([]), line);
  assert.equal(crossingAdvice([t('green_light')]), line, 'a green light seen by the model is not reported');
  assert.equal(crossingAdvice([t('red_light')]), line);
  assert.equal(crossingAdvice([t('green_light'), t('car', 5)]), `A vehicle is close. Wait. ${line}`);
  for (const x of [[], [t('green_light')], [t('car', 5)]]) assert.ok(!/safe|green/i.test(crossingAdvice(x)));
});
test('commands for notes and crossing', () => {
  assert.equal(parseCommand('can I cross').type, 'cross');
  assert.deepEqual(parseCommand('remember I put my keys in the drawer'), { type: 'noteAdd', arg: 'i put my keys in the drawer' });
  assert.equal(parseCommand('where did I put my keys').type, 'noteFind');
  assert.equal(parseCommand('what do you remember').type, 'noteList');
  assert.equal(parseCommand('save this place as home').type, 'save');
  assert.equal(parseCommand('remember my home').type, 'save');
});
