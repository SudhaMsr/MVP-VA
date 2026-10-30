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
test('crossing advice is cautious', () => {
  const t = (name, dist) => ({ name, hits: 3, dist });
  assert.match(crossingAdvice([t('red_light')]), /red\. Wait/);
  assert.match(crossingAdvice([t('green_light'), t('car', 5)]), /vehicle is close/);
  assert.match(crossingAdvice([t('green_light')]), /listen for traffic/);
  assert.match(crossingAdvice([]), /Do not rely on me/);
  assert.ok(!/safe to cross/i.test(crossingAdvice([t('green_light')])));
});
test('commands for notes and crossing', () => {
  assert.equal(parseCommand('can I cross').type, 'cross');
  assert.deepEqual(parseCommand('remember I put my keys in the drawer'), { type: 'noteAdd', arg: 'i put my keys in the drawer' });
  assert.equal(parseCommand('where did I put my keys').type, 'noteFind');
  assert.equal(parseCommand('what do you remember').type, 'noteList');
  assert.equal(parseCommand('save this place as home').type, 'save');
  assert.equal(parseCommand('remember my home').type, 'save');
});
