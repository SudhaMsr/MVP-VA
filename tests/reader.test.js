import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVision, readingSpeech, callVision } from '../docs/js/reader.js';

const word = (t) => ({ symbols: [...t].map((c) => ({ text: c })) });
const block = (words, x, y, w, h, confidence = 0.95) => ({
  confidence, boundingBox: { vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] },
  paragraphs: [{ words: words.map(word) }],
});
const resp = { fullTextAnnotation: { pages: [{ blocks: [
  block(['Open', '9am'], 0, 0, 40, 10),
  block(['TESCO', 'Express'], 0, 0, 300, 80),
  block(['|'], 0, 0, 5, 5),
  block(['TESCO', 'express'], 0, 0, 100, 20),
] }] } };

test('largest text first, duplicates and junk dropped', () => {
  const p = parseVision(resp);
  assert.deepEqual(p.pieces, ['TESCO Express', 'Open 9am']);
  assert.ok(p.confidence > 0.9);
});
test('speech: confident, unsure, nothing', () => {
  assert.equal(readingSpeech(parseVision(resp)), 'It says: TESCO Express. Open 9am.');
  assert.match(readingSpeech({ pieces: ['Bus 9'], confidence: 0.4 }), /^I am not sure, but it may say: Bus 9\./);
  assert.match(readingSpeech({ pieces: [], confidence: 0 }), /can't read any text/);
});
test('long text is clipped', () => {
  assert.ok(readingSpeech({ pieces: ['x'.repeat(300)], confidence: 0.9 }).length < 140);
});
test('callVision sends the photo and surfaces errors', async () => {
  let sent;
  const ok = await callVision('B64', 'K', async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ responses: [{ textAnnotations: [] }] }) }; });
  assert.deepEqual(ok, { textAnnotations: [] });
  assert.equal(sent.body.requests[0].features[0].type, 'TEXT_DETECTION');
  assert.match(sent.url, /images:annotate\?key=K$/);
  await assert.rejects(callVision('B', 'K', async () => ({ ok: false, status: 403, json: async () => ({}) })), /vision 403/);
  await assert.rejects(callVision('B', 'K', async () => ({ ok: true, json: async () => ({ responses: [{ error: { message: 'bad' } }] }) })), /bad/);
});
