// Ask Gemini (20 Nov): request shape, the safety filter on every answer, and the client's error handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiRequest, answerText, safeAnswer, needsPhoto, GeminiChat, SYSTEM_TEXT, UNSURE_TEXT, NO_ANSWER_TEXT } from '../docs/js/gemini.js';
import { CROSSING_TEXT, isSafeText } from '../docs/js/safetext.js';
import { parseCommand } from '../docs/js/commands.js';

const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const okFetch = (text, seen = []) => async (url, opts) => { seen.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => reply(text) }; };

test('request: system rules, photo before the question, context and short history', () => {
  const r = buildGeminiRequest({ question: 'what colour is this', base64Jpeg: 'AAA', context: 'person ahead', history: [1, 2, 3, 4].map((i) => ({ q: `q${i}`, a: `a${i}` })) });
  assert.equal(r.systemInstruction.parts[0].text, SYSTEM_TEXT);
  assert.equal(r.contents.length, 7); // 3 earlier turns (q+a) plus this one
  assert.equal(r.contents[0].parts[0].text, 'q2');
  const last = r.contents.at(-1);
  assert.equal(last.parts[0].inlineData.mimeType, 'image/jpeg');
  assert.match(last.parts[1].text, /person ahead[\s\S]*what colour is this/);
  assert.equal(buildGeminiRequest({ question: 'hi' }).contents[0].parts.length, 1); // no photo, no context
});

test('the rules given to Gemini say nothing banned and forbid reading signals and compass words', () => {
  assert.ok(isSafeText(SYSTEM_TEXT));
  assert.match(SYSTEM_TEXT, /cannot read traffic lights/); assert.match(SYSTEM_TEXT, /compass/); assert.match(SYSTEM_TEXT, /cane/);
});

test('answer text skips thought parts', () => {
  assert.equal(answerText({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'It is a red jumper.' }] } }] }), 'It is a red jumper.');
  assert.equal(answerText({}), '');
});

test('safe answer: plain text, never safety, never a signal colour, no compass words', () => {
  assert.equal(safeAnswer('**I think** it is a *blue* mug.'), 'I think it is a blue mug.');
  assert.equal(safeAnswer('The green man is showing, so go.'), CROSSING_TEXT);
  assert.equal(safeAnswer('The light is red right now.'), CROSSING_TEXT);
  assert.equal(safeAnswer('Yes, it is safe to cross now.'), UNSURE_TEXT);
  assert.equal(safeAnswer('All clear ahead.'), UNSURE_TEXT);
  assert.equal(safeAnswer('The cafe is to the north-west. It is about 20 steps away.'), 'It is about 20 steps away.');
  assert.equal(safeAnswer('Head south.'), UNSURE_TEXT);
  assert.equal(safeAnswer(''), NO_ANSWER_TEXT);
  assert.ok(safeAnswer('A long sentence here. '.repeat(40)).length <= 321);
  assert.equal(safeAnswer('There is a red bus ahead.'), 'There is a red bus ahead.'); // a red bus is not a signal
});

test('photo only for questions about what the camera shows', () => {
  assert.ok(needsPhoto('what colour is this jumper'));
  assert.ok(needsPhoto('Is this the 73 bus?'));
  assert.ok(!needsPhoto('tell me a joke about cats'));
  assert.ok(!needsPhoto('how do I make a cup of tea'));
});

test('free questions are not voice commands, so they reach Gemini', () => {
  for (const q of ['what colour is my jumper', 'tell me a joke', 'how do I boil an egg']) assert.equal(parseCommand(q).type, null, q);
});

test('client: answers, keeps short history, filters', async () => {
  const seen = [];
  const g = new GeminiChat({ key: 'k', model: 'm', fetchFn: okFetch('Is it safe? Yes, it is safe.', seen) });
  assert.equal(await g.ask('can I go'), UNSURE_TEXT);
  assert.match(seen[0].url, /models\/m:generateContent\?key=k$/);
  await g.ask('and now');
  assert.equal(seen[1].body.contents.length, 3); // one earlier turn + this one
});

test('client: a refused key stops it being used; other failures do not', async () => {
  const g = new GeminiChat({ key: 'k', model: 'm', fetchFn: async () => ({ ok: false, status: 403, text: async () => 'denied' }) });
  await assert.rejects(g.ask('hello there'));
  assert.equal(g.usable, false);
  const h = new GeminiChat({ key: 'k', model: 'm', fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }) });
  await assert.rejects(h.ask('hello there'));
  assert.equal(h.usable, true);
  assert.equal(new GeminiChat({ key: '', model: 'm' }).usable, false);
});

test('history is forgotten after 3 minutes', async () => {
  let t = 0; const seen = [];
  const g = new GeminiChat({ key: 'k', model: 'm', fetchFn: okFetch('Fine.', seen), now: () => t });
  await g.ask('one'); t = 200000; await g.ask('two');
  assert.equal(seen[1].body.contents.length, 1);
});
