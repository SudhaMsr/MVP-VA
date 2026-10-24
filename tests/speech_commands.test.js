import test from 'node:test';
import assert from 'node:assert/strict';
import { Speaker } from '../docs/js/speech.js';
import { parseCommand } from '../docs/js/commands.js';

// A fake speech engine that lets the test decide when each utterance ends.
function fakeEngine() {
  const spoken = [];
  const synth = {
    cancelled: 0,
    speak(u) { spoken.push(u); },
    cancel() { this.cancelled++; const cur = spoken[spoken.length - 1]; if (cur && cur.onerror) cur.onerror(); },
    getVoices() { return []; },
  };
  class Utt { constructor(text) { this.text = text; } }
  return { synth, Utt, spoken };
}
function make(opts = {}) {
  const f = fakeEngine();
  let now = 0;
  const timers = [];
  const sp = new Speaker(f.synth, f.Utt, {
    now: () => now,
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
    ...opts,
  });
  return { sp, f, timers, advance: (ms) => { now += ms; }, texts: () => f.spoken.map((u) => u.text) };
}

test('queues messages and plays them in order', () => {
  const { sp, f, texts } = make();
  sp.speak('one', 'status');
  sp.speak('two', 'status');
  assert.deepEqual(texts(), ['one']);
  f.spoken[0].onend();
  assert.deepEqual(texts(), ['one', 'two']);
});

test('urgent interrupts a routine alert and is never dropped', () => {
  const { sp, texts } = make();
  sp.speak('person left', 'normal');
  sp.speak('Caution car', 'urgent');
  assert.deepEqual(texts(), ['person left', 'Caution car']);
});

test('status messages are not dropped when the engine is busy (old prototype dropped them)', () => {
  const { sp, f, texts } = make();
  sp.speak('alert', 'normal');
  sp.speak('Stopped.', 'status');
  assert.deepEqual(texts(), ['alert']);
  f.spoken[0].onend();
  assert.deepEqual(texts(), ['alert', 'Stopped.']);
});

test('stale routine alerts are dropped instead of spoken late', () => {
  const { sp, f, advance, texts } = make({ staleMs: 2500 });
  sp.speak('first', 'status');
  sp.speak('old alert', 'normal');
  advance(4000);
  f.spoken[0].onend();
  assert.deepEqual(texts(), ['first']);
  assert.ok(sp.log.some((l) => l.event === 'dropped-stale'));
});

test('routine queue overflow drops the oldest routine alert only', () => {
  const { sp, f, texts } = make({ maxNormalQueued: 2 });
  sp.speak('busy', 'status');
  sp.speak('n1', 'normal');
  sp.speak('n2', 'normal');
  sp.speak('n3', 'normal');
  sp.speak('keep me', 'status');
  f.spoken[0].onend();
  f.spoken[1].onend();
  f.spoken[2].onend();
  assert.deepEqual(texts(), ['busy', 'n2', 'n3', 'keep me']);
});

test('watchdog frees the queue if the phone never fires onend', () => {
  const { sp, timers, texts } = make();
  sp.speak('stuck', 'status');
  sp.speak('next', 'status');
  assert.deepEqual(texts(), ['stuck']);
  timers[0].fn();
  assert.deepEqual(texts(), ['stuck', 'next']);
});

test('unsupported speech is reported, not silent', () => {
  const sp = new Speaker(undefined, undefined);
  assert.equal(sp.supported, false);
  assert.equal(sp.speak('hi'), false);
});

test('command parser', () => {
  assert.equal(parseCommand('start').type, 'start');
  assert.equal(parseCommand('Please STOP.').type, 'stop');
  assert.equal(parseCommand('say again').type, 'repeat');
  assert.equal(parseCommand('help').type, 'help');
  assert.deepEqual(parseCommand('navigate to Tesco Extra'), { type: 'navigate', arg: 'tesco extra' });
  assert.deepEqual(parseCommand('take me to the train station please'), { type: 'navigate', arg: 'the train station' });
  assert.equal(parseCommand('cancel navigation').type, 'cancel');
  assert.equal(parseCommand('nice weather today').type, null);
  assert.equal(parseCommand('').type, null);
});

test('read commands', async () => {
  const { parseCommand } = await import('../docs/js/commands.js');
  for (const s of ['read', 'Read this', 'what does it say?', 'read the sign', 'what shop is this', 'read again']) {
    assert.equal(parseCommand(s).type, 'read', s);
  }
  assert.notEqual(parseCommand('repeat').type, 'read');
});
