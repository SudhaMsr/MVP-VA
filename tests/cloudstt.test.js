// Google Speech-to-Text, tap to talk: the request, the reply, and when a clip ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseResponse, EndOfSpeech, PHRASES } from '../docs/js/cloudstt.js';

test('the request asks for British English, short commands, and weights the app\'s own phrases', () => {
  const r = buildRequest('QUJD', { sampleRate: 48000 });
  assert.equal(r.audio.content, 'QUJD');
  assert.equal(r.config.encoding, 'WEBM_OPUS');
  assert.equal(r.config.languageCode, 'en-GB');
  assert.equal(r.config.model, 'latest_short');
  assert.ok(r.config.speechContexts[0].phrases.includes('navigate me to'));
  assert.ok(PHRASES.includes('take me home'));
  assert.equal(buildRequest('x', { model: null }).config.model, undefined, 'fallback without a model');
});

test('the reply gives the words, or nothing', () => {
  assert.equal(parseResponse({ results: [{ alternatives: [{ transcript: 'navigate me to university of bristol' }] }] }), 'navigate me to university of bristol');
  assert.equal(parseResponse({ results: [{ alternatives: [{ transcript: 'navigate to ' }] }, { alternatives: [{ transcript: ' Tesco' }] }] }), 'navigate to Tesco');
  assert.equal(parseResponse({}), '');
  assert.equal(parseResponse(null), '');
});

test('a clip ends 0.9 s after the walker stops talking, at 7 s at most, and gives up after 5 s of silence', () => {
  const run = (levels, stepMs = 50) => { const e = new EndOfSpeech(); let r = 'listening', t = 0; for (const l of levels) { r = e.step(l, t); t += stepMs; if (r !== 'listening') break; } return [r, t]; };
  const speech = [...Array(10).fill(0.01), ...Array(30).fill(0.2), ...Array(40).fill(0.01)];
  const [r1, t1] = run(speech);
  assert.equal(r1, 'done'); assert.ok(t1 >= 2500 && t1 <= 3000, `ended at ${t1}`);
  assert.equal(run(Array(200).fill(0.01))[0], 'nothing');
  assert.ok(run(Array(200).fill(0.01))[1] <= 5100);
  const [r3, t3] = run(Array(300).fill(0.3));
  assert.equal(r3, 'done'); assert.ok(t3 <= 7100, 'non-stop noise is cut at 7 s');
});
