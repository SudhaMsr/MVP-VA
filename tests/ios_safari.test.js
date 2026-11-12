// Package I: iPhone Safari. Every iPhone browser is Safari underneath: no vibration, motion sensors behind a question
// asked from a tap, no WebM recording on older versions, and voice that only starts from a tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOutput, effectiveMode, NO_VIBRATE_TEXT, OUTPUT_MODES } from '../docs/js/output.js';
import { requestMotionAccess, unlockAudio, silentWav, WakeNotice, NO_WAKE_LOCK_TEXT, MOTION_DENIED_TEXT, MotionGate, isIOS } from '../docs/js/platform.js';
import { readFileSync } from 'node:fs';
import { pickRecording, downsample, toLinear16, buildRequest, PCM_RATE, CloudListener } from '../docs/js/cloudstt.js';
import { isSafeText } from '../docs/js/safetext.js';

test('a phone that cannot vibrate never leaves a hazard alert silent', () => {
  for (const kind of ['urgent', 'normal', 'nav']) {
    const r = routeOutput(kind, { mode: 'vibration', canVibrate: false });
    assert.equal(r.speak, true, `${kind} must be spoken when the phone cannot buzz`);
    assert.equal(r.vibrate, false);
  }
  // on a phone that can vibrate, vibration only is unchanged: routine alerts buzz instead of speaking
  assert.equal(routeOutput('normal', { mode: 'vibration', canVibrate: true }).speak, false);
  assert.equal(routeOutput('normal', { mode: 'vibration', canVibrate: true }).vibrate, true);
  assert.equal(routeOutput('urgent', { mode: 'vibration', canVibrate: true }).speak, true, 'vehicles are always spoken');
});

test('no output mode on any phone gives an alert with neither speech nor vibration', () => {
  for (const mode of OUTPUT_MODES) for (const canVibrate of [true, false]) {
    for (const kind of ['urgent', 'normal', 'nav']) {
      const r = routeOutput(kind, { mode, canVibrate });
      assert.ok(r.speak || r.vibrate, `${kind} in ${mode} (vibrate ${canVibrate}) would be silent`);
    }
  }
});

test('effectiveMode falls back from vibration only when the phone cannot vibrate', () => {
  assert.equal(effectiveMode('vibration', false), 'both');
  assert.equal(effectiveMode('vibration', true), 'vibration');
  assert.equal(effectiveMode('speech', false), 'speech');
  assert.equal(effectiveMode('nonsense', true), 'both');
});

test('motion access: asked on iPhone, not needed on Android, refused is reported', async () => {
  const asked = [];
  const iphone = (answer) => ({
    DeviceOrientationEvent: { requestPermission: async () => { asked.push('o'); return answer; } },
    DeviceMotionEvent: { requestPermission: async () => { asked.push('m'); return answer; } },
  });
  assert.equal(await requestMotionAccess(iphone('granted')), 'granted');
  assert.deepEqual(asked, ['o', 'm'], 'both sensors are asked for');
  assert.equal(await requestMotionAccess(iphone('denied')), 'denied');
  assert.equal(await requestMotionAccess({ DeviceOrientationEvent: { requestPermission: async () => { throw new Error('no tap'); } } }), 'denied');
  assert.equal(await requestMotionAccess({ DeviceOrientationEvent: function () {}, DeviceMotionEvent: function () {} }), 'not-needed');
  assert.equal(await requestMotionAccess({}), 'unavailable');
});

test('audio unlock speaks a silent line and plays a silent clip, once', async () => {
  const spoken = []; let played = 0;
  class U { constructor(t) { this.text = t; } }
  const audio = { play: () => { played += 1; return Promise.resolve(); }, pause() {} };
  const r = unlockAudio({ synth: { speak: (u) => spoken.push(u) }, Utterance: U, audio });
  assert.deepEqual(r, { speech: true, player: true });
  assert.equal(spoken[0].volume, 0);
  assert.match(audio.src, /^data:audio\/wav;base64,/);
  unlockAudio({ audio }); assert.equal(played, 1, 'the player is unlocked only once');
  assert.deepEqual(unlockAudio({}), { speech: false, player: false }, 'nothing to unlock is fine');
  await Promise.resolve(); assert.equal(audio.muted, false, 'the player is not left muted');
});

test('the silent clip is a real WAV file', () => {
  const b = Buffer.from(silentWav(100).split(',')[1], 'base64');
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt32LE(4), b.length - 8); assert.equal(b.length, 44 + 200);
});

test('recording: WebM where possible, raw 16 kHz sound where Google cannot take what the phone records', () => {
  assert.deepEqual(pickRecording((m) => m === 'audio/webm;codecs=opus'), { encoding: 'WEBM_OPUS', mime: 'audio/webm;codecs=opus' });
  assert.equal(pickRecording((m) => m === 'audio/ogg;codecs=opus').encoding, 'OGG_OPUS');
  assert.deepEqual(pickRecording((m) => m === 'audio/mp4'), { encoding: 'LINEAR16', mime: null }, 'AAC in MP4 is not accepted by Google');
  assert.equal(pickRecording(null).encoding, 'LINEAR16');
  assert.equal(pickRecording(() => { throw new Error('x'); }).encoding, 'LINEAR16');
  const req = buildRequest('AAAA', { encoding: 'LINEAR16', sampleRate: PCM_RATE });
  assert.equal(req.config.encoding, 'LINEAR16'); assert.equal(req.config.sampleRateHertz, 16000);
  assert.equal(buildRequest('AAAA').config.encoding, 'WEBM_OPUS', 'Android is unchanged');
});

test('downsample 48 kHz to 16 kHz and convert to 16-bit', () => {
  const x = new Float32Array(48).map((_, i) => (i % 3 === 0 ? 0.3 : 0.6));
  const d = downsample(x, 48000, 16000);
  assert.equal(d.length, 16); assert.ok(Math.abs(d[0] - 0.5) < 1e-6);
  assert.equal(downsample(new Float32Array(10), 16000, 16000).length, 10);
  const b = toLinear16(Float32Array.from([0, 1, -1, 2]));
  const v = new DataView(b.buffer);
  assert.equal(v.getInt16(0, true), 0); assert.equal(v.getInt16(2, true), 32767); assert.equal(v.getInt16(4, true), -32768);
  assert.equal(v.getInt16(6, true), 32767, 'clipped');
});

test('screen-lock notice is said once, only when the screen cannot be kept on', () => {
  const said = []; const w = new WakeNotice((t) => said.push(t));
  assert.equal(w.report(true), false);
  assert.equal(w.report(false), true); assert.equal(w.report(false), false);
  assert.deepEqual(said, [NO_WAKE_LOCK_TEXT]);
});

test('the new lines are short, plain and never imply safety', () => {
  for (const t of [NO_VIBRATE_TEXT, NO_WAKE_LOCK_TEXT, MOTION_DENIED_TEXT]) assert.ok(isSafeText(t), t);
});

// F-I1: motion access is asked only from a real tap. A fake iPhone that behaves like Safari: requestPermission() rejects
// (without showing anything) when there is no tap, and gives the walker's answer when there is one.
function fakeIphone(answer = 'granted') {
  const w = { tap: false, asked: 0 };
  const ask = async () => { w.asked += 1; if (!w.tap) throw new Error('NotAllowedError: needs a user gesture'); return answer; };
  w.DeviceOrientationEvent = { requestPermission: ask };
  w.DeviceMotionEvent = { requestPermission: ask };
  return w;
}

test('F-I1: an automatic restart (no tap) never asks for motion access and never records "denied"', async () => {
  const w = fakeIphone('granted'); const logs = [];
  const g = new MotionGate({ log: (k, v) => logs.push([k, v]) });
  // The page becomes visible again and start({ fromTap: false }) runs: nothing is asked.
  assert.equal(g.onStart(w, { fromTap: false }), null);
  assert.equal(w.asked, 0, 'no question without a tap');
  assert.equal(g.access, 'unknown', 'no tap is not an answer: still unknown, not denied');
  assert.equal(logs[0][0], 'motion-access-skipped');
  // The walker taps Start: now it is asked, and the real answer is kept.
  w.tap = true;
  assert.equal(await g.onStart(w, { fromTap: true }), 'granted');
  assert.equal(w.asked, 2, 'both sensors asked, once each');
  assert.equal(g.access, 'granted');
  w.tap = false;
  assert.equal(g.onStart(w, { fromTap: false }), null);
  assert.equal(g.onStart(w, { fromTap: true }), null, 'granted: never asked again');
  assert.equal(w.asked, 2);
});

test('F-I1: before the fix, a restart without a tap was recorded as denied (the bug this guards against)', async () => {
  const w = fakeIphone('granted');
  assert.equal(await requestMotionAccess(w), 'denied', 'Safari refuses a question with no tap; that must not reach the gate');
  const g = new MotionGate();
  g.onStart(w, { fromTap: false });
  assert.notEqual(g.access, 'denied');
});

test('F-I1: a real "no" is kept; a later tap may ask again; never two questions at once; Android never asks', async () => {
  const w = fakeIphone('denied'); w.tap = true;
  const g = new MotionGate();
  const p = g.onStart(w, { fromTap: true });
  assert.equal(g.onStart(w, { fromTap: true }), null, 'already asking');
  assert.equal(await p, 'denied');
  assert.equal(g.access, 'denied', 'the walker said no: calibrate can explain how to allow it');
  w.tap = false;
  assert.equal(g.onStart(w, { fromTap: false }), null, 'an automatic restart does not ask again');
  assert.equal(g.access, 'denied');
  w.tap = true;
  assert.notEqual(g.onStart(w, { fromTap: true }), null, 'a new tap on Start may ask again (as before F-I1)');
  const android = new MotionGate();
  assert.equal(await android.onStart({ DeviceOrientationEvent: function () {}, DeviceMotionEvent: function () {} }, { fromTap: true }), 'not-needed');
  assert.equal(android.onStart({}, { fromTap: true }), null, 'not-needed: never asked again');
});

test('F-I1: every caller of start() and talk() in app.js says whether it is a tap', () => {
  const src = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  // Calls of the app's own start()/talk(), not object methods such as battery.start() or recognition.start().
  const calls = [...src.matchAll(/(?<![.\w])(start|talk)\(([^)]*)\)/g)].filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index - 16), m.index)));
  assert.ok(calls.length >= 6, `found ${calls.length} calls`);
  for (const m of calls) {
    assert.match(m[2], /^\{ fromTap(: (true|false))? \}$/, `${m[0]} must say { fromTap: true|false }`);
  }
  assert.match(src, /el\.start\.addEventListener\('click',[^\n]*start\(\{ fromTap: true \}\)/, 'Start button is a tap');
  assert.match(src, /el\.talk\.addEventListener\('click',[^\n]*talk\(\{ fromTap: true \}\)/, 'Talk button is a tap');
  const vis = src.slice(src.indexOf("document.addEventListener('visibilitychange'"), src.indexOf("// ---------- voice commands"));
  assert.match(vis, /start\(\{ fromTap: false \}\)/, 'the automatic restart is not a tap');
  assert.doesNotMatch(vis, /fromTap: true/);
  assert.match(src, /case 'start': start\(\{ fromTap: false \}\)/, 'a spoken "start" is not a tap');
  assert.doesNotMatch(src, /requestMotionAccess\(/, 'app.js asks only through MotionGate');
});

test('isIOS: iPhone and iPad (which says Macintosh) yes; Android and a Mac without touch no', () => {
  assert.equal(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', maxTouchPoints: 5 }), true);
  assert.equal(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 }), true);
  assert.equal(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 0 }), false);
  assert.equal(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 11; M2003J15SC) Chrome/130.0 Mobile', maxTouchPoints: 5 }), false);
});

// A fake microphone: counts how many are open, so a test can see whether the app lets go of it.
function fakeMic() {
  const mic = { open: 0, asked: 0 };
  const stream = () => { mic.open += 1; let live = true; const tr = { get readyState() { return live ? 'live' : 'ended' }, stop() { if (live) { live = false; mic.open -= 1; } }, getSettings: () => ({ channelCount: 1 }) };
    return { getAudioTracks: () => [tr], getTracks: () => [tr] }; };
  mic.getUserMedia = async () => { mic.asked += 1; return stream(); };
  return mic;
}
async function withNavigator(mic, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: mic.getUserMedia } }, configurable: true, writable: true });
  try { return await fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
}

test('iPhone: the microphone is opened at Start for the permission question, then let go; Safari goes back to playback', async () => {
  const mic = fakeMic(); const session = { type: 'auto' };
  await withNavigator(mic, async () => {
    const ios = new CloudListener({ key: 'k', keepMic: false, audioSession: session });
    await ios.prime();
    assert.equal(mic.asked, 1, 'asked once, inside the Start tap');
    assert.equal(mic.open, 0, 'not held open while walking: speech would play quietly, as a phone call');
    assert.equal(session.type, 'playback');
    ios._session('play-and-record'); assert.equal(session.type, 'play-and-record');
    ios._release(); assert.equal(session.type, 'playback');
  });
});

test('Android is unchanged: the microphone stays open between taps and no audio session is touched', async () => {
  const mic = fakeMic(); const session = { type: 'auto' };
  await withNavigator(mic, async () => {
    const android = new CloudListener({ key: 'k', audioSession: session });
    await android.prime(); await android._mic();
    assert.equal(mic.asked, 1, 'reused, not asked again');
    assert.equal(mic.open, 1);
    android._release();
    assert.equal(mic.open, 1); assert.equal(session.type, 'auto');
    android.close(); assert.equal(mic.open, 0, 'Stop still lets go');
  });
});

test('app.js lets go of the microphone only on iPhone', () => {
  const src = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /new CloudListener\(\{[^}]*keepMic: !isIOS\(\)/);
  assert.match(src, /cloud\.prime\(\)/);
});

test('12 Nov: Android Chrome with requestPermission answering "prompt" is never asked and never told motion is off', async () => {
  let asked = 0;
  const ask = async () => { asked += 1; return 'prompt'; };
  const android = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 11; M2003J15SC) Chrome/153.0 Mobile', maxTouchPoints: 5 },
    DeviceOrientationEvent: { requestPermission: ask }, DeviceMotionEvent: { requestPermission: ask } };
  assert.equal(await requestMotionAccess(android), 'not-needed');
  assert.equal(asked, 0);
  const iphone = { ...android, navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', maxTouchPoints: 5 } };
  assert.equal(await requestMotionAccess(iphone), 'unknown', '"prompt" is not a no');
  assert.equal(asked, 2);
});
