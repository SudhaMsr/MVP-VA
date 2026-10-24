import test from 'node:test';
import assert from 'node:assert/strict';
import { pickText, readingSpeech } from '../docs/js/reader.js';

const items = [
  { text: 'Open 9am', size: 400, conf: 0.9 },
  { text: 'TESCO Express', size: 24000, conf: 0.95 },
  { text: '| ~ _', size: 25, conf: 0.9 },
  { text: 'tesco express', size: 2000, conf: 0.9 },
  { text: 'xq', size: 9000, conf: 0.2 },
];

test('largest text first; duplicates, symbols and low-confidence junk dropped', () => {
  const p = pickText(items);
  assert.deepEqual(p.pieces, ['TESCO Express', 'Open 9am']);
  assert.ok(p.confidence > 0.9);
});
test('engine without confidence is accepted', () => {
  assert.deepEqual(pickText([{ text: 'Bus 9', size: 100, conf: null }]).pieces, ['Bus 9']);
});
test('speech: confident, unsure, nothing', () => {
  assert.equal(readingSpeech(pickText(items)), 'It says: TESCO Express. Open 9am.');
  assert.match(readingSpeech({ pieces: ['Bus 9'], confidence: 0.4 }), /^I am not sure, but it may say: Bus 9\./);
  assert.match(readingSpeech({ pieces: [], confidence: 0 }), /can't read any text/);
});
test('long text is clipped', () => {
  assert.ok(readingSpeech({ pieces: ['x'.repeat(300)], confidence: 0.9 }).length < 140);
});
