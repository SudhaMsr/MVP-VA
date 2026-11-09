// Package I: iPhone Safari. Every iPhone browser is Safari underneath: no vibration, motion sensors behind a question
// asked from a tap, no WebM recording on older versions, and voice that only starts from a tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeOutput, effectiveMode, NO_VIBRATE_TEXT, OUTPUT_MODES } from '../docs/js/output.js';
import { requestMotionAccess, unlockAudio, silentWav, WakeNotice, NO_WAKE_LOCK_TEXT, MOTION_DENIED_TEXT } from '../docs/js/platform.js';
import { pickRecording, downsample, toLinear16, buildRequest, PCM_RATE } from '../docs/js/cloudstt.js';
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
