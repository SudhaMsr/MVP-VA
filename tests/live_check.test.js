// 12 Nov live check on the real site (real Google listening, places and routes in Chrome).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Speaker } from '../docs/js/speech.js';

function fakeSpeaker() {
  const said = []; let cur = null;
  const synth = { speak(u) { said.push(u.text); cur = u; }, cancel() {}, getVoices: () => [] };
  function U(t) { this.text = t; }
  const sp = new Speaker(synth, U, { setTimer: () => 0, clearTimer: () => {} });
  return { sp, said, end: () => cur && cur.onend && cur.onend() };
}

test('the route summary is spoken before the first turn prompt, even when the turn comes in while the summary waits', () => {
  const { sp, said, end } = fakeSpeaker();
  sp.speak('Looking for university of bristol.', 'status');
  sp.speak('Going to University of Bristol, Beacon House. About 10 minutes. First, walk straight for 30 steps.', 'nav');
  sp.speak('In 40 steps, turn right.', 'nav');
  end(); end(); end();
  assert.deepEqual(said, ['Looking for university of bristol.', 'Going to University of Bristol, Beacon House. About 10 minutes. First, walk straight for 30 steps.', 'In 40 steps, turn right.']);
});

test('nav.js says the route summary as a direction (nav), not a status message that a turn prompt could overtake', () => {
  const src = readFileSync(new URL('../docs/js/nav.js', import.meta.url), 'utf8');
  assert.match(src, /`New route\. \$\{instructionText\(first0\)\} for \$\{roundMetres\(first0\.distance\)\}\.`, 'nav'\)/);
});

test('end of speech is measured on the audio thread with the audio clock, with a timer only as a back-up', () => {
  const src = readFileSync(new URL('../docs/js/cloudstt.js', import.meta.url), 'utf8');
  assert.match(src, /tap\.onaudioprocess = \(e\) => \{[\s\S]*?eos\.step\(Math\.sqrt\(q \/ d\.length\), audioMs\)/);
  assert.match(src, /if \(blocks === 0 && el > 500\)/);
  assert.match(src, /if \(el > eos\.maxMs \+ 2000\)/);
});
