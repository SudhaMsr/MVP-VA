// Package D: accessibility for screen-reader users. Output routing, output modes, distinct haptics, the page structure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from '../docs/js/haptics.js';
import { routeOutput, OUTPUT_MODES, outputText } from '../docs/js/output.js';
import { parseCommand, HELP_TEXT } from '../docs/js/commands.js';
import { isSafeText } from '../docs/js/safetext.js';

const { Haptics } = H;

test('six named haptic patterns, no two the same', () => {
  const named = { VEHICLE: H.VEHICLE, OBSTACLE: H.OBSTACLE, TURN_LEFT: H.TURN_LEFT, TURN_RIGHT: H.TURN_RIGHT, ARRIVED: H.ARRIVED, LOST_SIGNAL: H.LOST_SIGNAL, STOP: H.STOP, STAIRS: H.STAIRS };
  const seen = new Map();
  for (const [k, v] of Object.entries(named)) {
    assert.ok(Array.isArray(v) && v.length && v.every((x) => x > 0), k);
    const key = v.join(',');
    assert.ok(!seen.has(key), `${k} is the same as ${seen.get(key)}`);
    seen.set(key, k);
  }
});

test('which buzz goes with which message', () => {
  assert.equal(Haptics.kindFor({ urgent: true, text: 'Caution. Car approaching.' }), 'urgent');
  assert.equal(Haptics.kindFor({ urgent: false, key: 'pole:ahead', text: 'Pole, ahead, close.' }), null, 'speech and vibration: ordinary alerts do not buzz');
  assert.equal(Haptics.kindFor({ urgent: false, key: 'pole:ahead', text: 'Pole, ahead, close.' }, 'vibration'), 'obstacle', 'vibration only: they do');
  assert.equal(Haptics.kindForNav('Turn left onto High Street now.'), 'turn_left');
  assert.equal(Haptics.kindForNav('Turn right now, then turn left onto Mill Lane.'), 'turn_right');
  assert.equal(Haptics.kindForNav('In 40 steps, turn left onto High Street.'), null, 'the early warning does not buzz');
  assert.equal(Haptics.kindForNav('You should be near your destination. It may be a few steps either way.'), 'arrived');
  assert.equal(Haptics.kindForNav('You have arrived at Tesco.'), 'arrived');
  assert.equal(Haptics.kindForNav('I lost your location signal.'), 'lost');
  assert.equal(Haptics.kindForNav('Location signal is back.'), null);
});

test('a vehicle buzz always gets through; others are spaced out', () => {
  const sent = []; const h = new Haptics((p) => { sent.push(p); return true; });
  assert.equal(h.buzz('obstacle', 5000), true);
  assert.equal(h.buzz('turn_left', 5500), false);
  assert.equal(h.buzz('urgent', 5600), true, 'never held back by a recent buzz');
  assert.deepEqual(sent, [H.OBSTACLE, H.VEHICLE]);
});

test('screen reader mode: status lines go to the live region; warnings and turns are still spoken', () => {
  const sr = { mode: 'both', screenReader: true };
  assert.deepEqual(routeOutput('status', sr), { speak: false, live: true, vibrate: false });
  for (const k of ['urgent', 'normal', 'nav']) assert.equal(routeOutput(k, sr).speak, true, k);
  assert.deepEqual(routeOutput('status', { mode: 'both' }), { speak: true, live: false, vibrate: false }, 'off by default');
});

test('output modes: vibration only still speaks vehicles and turns; speech only never vibrates', () => {
  const v = { mode: 'vibration' };
  assert.deepEqual(routeOutput('normal', v), { speak: false, live: false, vibrate: true });
  assert.equal(routeOutput('urgent', v).speak, true, 'vehicle warnings are always spoken');
  assert.equal(routeOutput('nav', v).speak, true);
  assert.equal(routeOutput('status', v).speak, true, 'answers to questions are still spoken');
  for (const k of ['urgent', 'normal', 'nav', 'status']) assert.equal(routeOutput(k, { mode: 'speech' }).vibrate, false, k);
  for (const k of ['urgent', 'normal', 'nav']) assert.equal(routeOutput(k, { mode: 'both' }).speak, true, k);
  assert.deepEqual(OUTPUT_MODES, ['both', 'vibration', 'speech']);
  for (const m of OUTPUT_MODES) assert.ok(isSafeText(outputText(m)));
});

test('voice commands for output and screen reader mode', () => {
  assert.deepEqual(parseCommand('vibration only'), { type: 'output', arg: 'vibration' });
  assert.deepEqual(parseCommand('speech only'), { type: 'output', arg: 'speech' });
  assert.deepEqual(parseCommand('speech and vibration'), { type: 'output', arg: 'both' });
  assert.deepEqual(parseCommand('vibration off'), { type: 'vibration', arg: 'off' }, 'the older command still works');
  assert.deepEqual(parseCommand('screen reader mode on'), { type: 'screenReader', arg: 'on' });
  assert.deepEqual(parseCommand('turn off talkback mode'), { type: 'screenReader', arg: 'off' });
  assert.match(HELP_TEXT, /vibration only/); assert.match(HELP_TEXT, /screen reader mode/);
});

test('page: Start/Stop and Talk come first, every control is named by its visible text', () => {
  const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/<(button|summary)\b([^>]*)>/g)].map((m) => (m[2].match(/id="([^"]+)"/) || [])[1] || m[1]);
  assert.deepEqual(ids.slice(0, 3), ['startBtn', 'talkBtn', 'summary']);
  assert.ok(!html.includes('stopBtn'), 'one Start/Stop button');
  assert.ok(!/<button[^>]*aria-label=/.test(html), 'no button has a name different from its text (axe label-content-name-mismatch)');
  assert.match(html, /id="srLive"[^>]*aria-live="polite"/);
  const app = fs.readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /'Stop walking'/); assert.match(app, /'Start walking'/);
});
