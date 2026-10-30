import test from 'node:test';
import assert from 'node:assert/strict';
import { Haptics, PATTERNS } from '../docs/js/haptics.js';
import { parseCommand } from '../docs/js/commands.js';

test('urgent, no-clear-way and stairs alerts get a buzz; ordinary ones do not', () => {
  assert.equal(Haptics.kindFor({ urgent: true, text: 'Caution. Car approaching.' }), 'urgent');
  assert.equal(Haptics.kindFor({ urgent: false, text: 'Person, ahead, about 2 metres. No clear way. Stop.' }), 'stop');
  assert.equal(Haptics.kindFor({ urgent: false, text: 'No clear way. Stop.' }), 'stop');
  assert.equal(Haptics.kindFor({ urgent: false, key: 'stairs:ahead', text: 'Stairs, ahead.' }), 'stairs');
  assert.equal(Haptics.kindFor({ urgent: false, key: 'person:ahead', text: 'Person, ahead.' }), null);
});

test('buzzes follow the pattern, switch off, and never come in a stream', () => {
  const sent = []; const h = new Haptics((p) => { sent.push(p); return true; });
  assert.equal(h.buzz('urgent', 10000), true); assert.deepEqual(sent[0], PATTERNS.urgent);
  assert.equal(h.buzz('stairs', 10500), false, 'too soon after the last one');
  assert.equal(h.buzz('stairs', 12000), true);
  h.set(false); assert.equal(h.buzz('urgent', 30000), false);
  assert.equal(new Haptics(null).buzz('urgent'), false, 'a phone that cannot vibrate is fine');
});

test('vibration voice commands', () => {
  for (const p of ['vibration off', 'turn off the vibration', 'stop vibrating', 'turn off vibration', 'haptics off']) assert.deepEqual(parseCommand(p), { type: 'vibration', arg: 'off' }, p);
  for (const p of ['vibration on', 'turn on vibration', 'switch on the buzz']) assert.deepEqual(parseCommand(p), { type: 'vibration', arg: 'on' }, p);
});
