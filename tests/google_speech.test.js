// Google voice (Cloud Text-to-Speech) and Google listening that keeps working (8 Nov).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Speaker } from '../docs/js/speech.js';
import { CloudVoice, buildTtsRequest } from '../docs/js/cloudtts.js';
import { CloudListener } from '../docs/js/cloudstt.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// A Speaker with a fake phone voice and a fake Google voice.
function rig({ kept = {}, usable = true, fetchOk = true } = {}) {
  const phone = [], google = [], fetched = [];
  let lastU = null, lastPlay = null, resolveFetch = null;
  const synth = { speak: (u) => { lastU = u; phone.push(u.text); }, cancel: () => {} };
  const cloud = {
    usable,
    cached: (t) => kept[t] || null,
    fetch: (t) => { fetched.push(t); return fetchOk === 'wait' ? new Promise((r) => { resolveFetch = () => r(`url:${t}`); }) : fetchOk ? Promise.resolve(`url:${t}`) : Promise.reject(new Error('offline')); },
  };
  const player = (url, onEnd, onError) => { google.push(url); lastPlay = { onEnd, onError }; return { stop() {} }; };
  const sp = new Speaker(synth, function (t) { this.text = t; }, { setTimer: () => 0, clearTimer: () => {}, cloud, player });
  return {
    sp, phone, google, fetched, cloud,
    endPhone: () => lastU && lastU.onend && lastU.onend(),
    endGoogle: () => lastPlay && lastPlay.onEnd(),
    failGoogle: () => lastPlay && lastPlay.onError(),
    resolve: () => resolveFetch && resolveFetch(),
  };
}

test('a line already fetched from Google plays in the Google voice', () => {
  const r = rig({ kept: { 'Turn left now.': 'url:kept' } });
  r.sp.speak('Turn left now.', 'nav');
  assert.deepEqual(r.google, ['url:kept']);
  assert.deepEqual(r.phone, []);
  assert.equal(r.sp.lastVoice, 'google');
});

test('a new line is fetched from Google, then played in the Google voice', async () => {
  const r = rig();
  r.sp.speak('Going to 25 Lakeside. About 50 minutes.', 'status');
  await tick();
  assert.deepEqual(r.google, ['url:Going to 25 Lakeside. About 50 minutes.']);
  assert.deepEqual(r.phone, []);
});

test('when Google cannot be reached, the phone says the line instead: nothing is lost', async () => {
  const r = rig({ fetchOk: false });
  r.sp.speak('In 40 steps, turn right.', 'nav');
  await tick();
  assert.deepEqual(r.phone, ['In 40 steps, turn right.']);
  assert.equal(r.sp.lastVoice, 'phone');
});

test('with no signal at all, the phone voice is used straight away', () => {
  const r = rig({ usable: false });
  r.sp.speak('Turn right now.', 'nav');
  assert.deepEqual(r.phone, ['Turn right now.']);
  assert.deepEqual(r.fetched, []);
});

test('an urgent vehicle warning never waits for Google: phone voice at once, Google fetched for next time', () => {
  const r = rig({ fetchOk: 'wait' });
  r.sp.speak('Caution. Car approaching, ahead, about 10 steps.', 'urgent');
  assert.deepEqual(r.phone, ['Caution. Car approaching, ahead, about 10 steps.'], 'spoken synchronously');
  assert.deepEqual(r.fetched, ['Caution. Car approaching, ahead, about 10 steps.']);
});

test('an urgent warning already fetched plays in the Google voice', () => {
  const r = rig({ kept: { 'Stop.': 'url:stop' } });
  r.sp.speak('Stop.', 'urgent');
  assert.deepEqual(r.google, ['url:stop']);
});

test('an urgent warning cuts off a line still being fetched, and that line does not play over it later', async () => {
  const r = rig({ fetchOk: 'wait' });
  r.sp.speak('Person, front left, about 6 steps.', 'normal');
  r.sp.speak('Caution. Bus approaching, ahead, about 8 steps.', 'urgent');
  assert.deepEqual(r.phone, ['Caution. Bus approaching, ahead, about 8 steps.']);
  r.resolve(); await tick();
  assert.deepEqual(r.google, [], 'the late Google audio is not played');
});

test('if the Google audio will not play, the phone says it', () => {
  const r = rig({ kept: { 'Turn left now.': 'url:kept' } });
  r.sp.speak('Turn left now.', 'nav');
  r.failGoogle();
  assert.deepEqual(r.phone, ['Turn left now.']);
});

test('queue order still holds with the Google voice', () => {
  const r = rig({ kept: { A: 'url:A', B: 'url:B' } });
  r.sp.speak('A', 'status'); r.sp.speak('B', 'status');
  assert.deepEqual(r.google, ['url:A']);
  r.endGoogle();
  assert.deepEqual(r.google, ['url:A', 'url:B']);
});

test('without Google set up, the phone voice works as before', () => {
  const phone = [];
  const sp = new Speaker({ speak: (u) => phone.push(u.text), cancel: () => {} }, function (t) { this.text = t; }, { setTimer: () => 0, clearTimer: () => {} });
  sp.speak('Hello.', 'status');
  assert.deepEqual(phone, ['Hello.']);
});

// ---- CloudVoice ----
const ok = (j) => ({ ok: true, status: 200, json: async () => j });

test('Google voice request: British voice, MP3, the walker\'s speed', () => {
  const b = buildTtsRequest('Turn left now.', { rate: 0.8 });
  assert.equal(b.input.text, 'Turn left now.');
  assert.equal(b.voice.languageCode, 'en-GB');
  assert.equal(b.audioConfig.audioEncoding, 'MP3');
  assert.equal(b.audioConfig.speakingRate, 0.8);
});

test('a fetched line is kept, so it is not fetched again', async () => {
  let calls = 0;
  const v = new CloudVoice({ key: 'k', online: () => true, fetchFn: async () => { calls++; return ok({ audioContent: 'QUJD' }); } });
  assert.equal(v.cached('Stop.', 1), null);
  const u = await v.fetch('Stop.', 1);
  assert.match(u, /^data:audio\/mpeg;base64,QUJD$/);
  assert.equal(v.cached('Stop.', 1), u);
  await v.fetch('Stop.', 1);
  assert.equal(calls, 1);
});

test('a refused key (Text-to-Speech not enabled) stops Google voice and says why once in the log', async () => {
  const logs = [];
  const v = new CloudVoice({ key: 'k', online: () => true, log: (k) => logs.push(k), fetchFn: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  await assert.rejects(v.fetch('Hi.', 1));
  assert.equal(v.usable, false);
  assert.deepEqual(logs, ['cloud-tts-refused']);
});

test('a network failure does not switch Google voice off', async () => {
  const v = new CloudVoice({ key: 'k', online: () => true, fetchFn: async () => { throw new Error('net'); } });
  await assert.rejects(v.fetch('Hi.', 1));
  await assert.rejects(v.fetch('Hi again.', 1));
  assert.equal(v.usable, true);
});

test('offline: Google voice is not tried', () => {
  const v = new CloudVoice({ key: 'k', online: () => false });
  assert.equal(v.usable, false);
});

// ---- Google listening ----
const sttOk = (text) => ({ ok: true, status: 200, json: async () => ({ results: [{ alternatives: [{ transcript: text }] }] }), text: async () => '' });

test('listening: a network blip is tried once more and then works', async () => {
  let n = 0;
  const l = new CloudListener({ key: 'k', retryMs: 0, fetchFn: async () => { if (++n === 1) throw new Error('net'); return sttOk('take me home'); } });
  assert.equal(await l._recognise('AAA', 48000), 'take me home');
  assert.equal(n, 2);
});

test('listening: a Google hiccup (503) is tried once more', async () => {
  let n = 0;
  const l = new CloudListener({ key: 'k', retryMs: 0, fetchFn: async () => (++n === 1 ? { ok: false, status: 503, text: async () => '' } : sttOk('where am I')) });
  assert.equal(await l._recognise('AAA', 48000), 'where am I');
});

test('listening: repeated network failures never switch Google off for the walk', async () => {
  const l = new CloudListener({ key: 'k', retryMs: 0, fetchFn: async () => { throw new Error('net'); } });
  for (let i = 0; i < 5; i++) await assert.rejects(l._recognise('AAA', 48000));
  assert.equal(l.refused, false);
});

test('listening: only a refused key switches Google off', async () => {
  const l = new CloudListener({ key: 'k', retryMs: 0, fetchFn: async () => ({ ok: false, status: 403, text: async () => 'denied' }) });
  await assert.rejects(l._recognise('AAA', 48000));
  assert.equal(l.refused, true);
});

test('app: a signal failure keeps Google listening for the next tap; the phone voice is the fallback for speaking', () => {
  const app = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(cloud\.refused \|\| \(e && e\.name === 'NotAllowedError'\)\) \{\s*\/\/[^\n]*\n\s*cloudOff = true;/);
  assert.match(app, /I could not reach Google, the signal may be weak\. Tap the screen and try again\./);
  assert.match(app, /cloud: cloudVoice, player: cloudVoice && ttsAudio \? playTts : null/);
});
