// Speech queue. Three kinds of message:
//   urgent - interrupts whatever is playing; never dropped
//   nav    - time-critical turn prompts: go ahead of queued status and routine messages, drop stale routine alerts,
//            and cut off a routine alert in progress (a late "turn left now" is useless); never dropped themselves
//   status - queued in order; never dropped (command feedback, errors, route summaries)
//   normal - routine alerts; dropped if they have become stale or the queue is long
// The old prototype silently dropped everything while it was already speaking. This does not.
// Voice: Google Cloud Text-to-Speech when opts.cloud is given and Google can be reached (cloudtts.js), else the phone's own
// voice. A line Google cannot deliver is spoken by the phone instead, never dropped. An urgent line that is not already
// kept from Google uses the phone's voice straight away: a vehicle warning must never wait for the network.
// Speech speeds the walker can step through (1.0 is the voice's normal pace).
export const RATES = [0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.1];
// The next speed up (dir 1) or down (-1) from the current one, or null when already at the end.
export function stepRate(current, dir) {
  let i = 0;
  RATES.forEach((r, k) => { if (Math.abs(r - current) < Math.abs(RATES[i] - current)) i = k; });
  const j = i + dir;
  return j < 0 || j >= RATES.length ? null : RATES[j];
}

export class Speaker {
  constructor(synth, UtteranceCtor, opts = {}) {
    this.synth = synth;
    this.Utterance = UtteranceCtor;
    this.rate = opts.rate ?? 0.8;
    this.lang = opts.lang ?? 'en-GB';
    this.staleMs = opts.staleMs ?? 2500;
    this.maxNormalQueued = opts.maxNormalQueued ?? 2;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    this.queue = [];
    this.current = null;
    this.watchdog = null;
    this.lastEnd = 0;
    this.log = []; // for tests and field-test review
    this.errors = 0;
    this.supported = !!(synth && UtteranceCtor);
    this.voice = null;
    this.onSpoken = null;
    this.held = false;
    this.dupMs = opts.dupMs ?? 30000; // the same routine alert is never spoken twice within this time
    this.said = new Map();
    this.cloud = opts.cloud || null; // { usable, cached(text, rate), fetch(text, rate) }
    this.player = opts.player || null; // (url, onEnd, onError) -> { stop() }
    this.playing = null;
    this.lastVoice = null; // 'google' or 'phone', for the session log
  }

  pickVoice() {
    if (!this.supported || this.voice) return;
    try {
      const voices = this.synth.getVoices ? this.synth.getVoices() : [];
      this.voice = voices.find((v) => v.lang === this.lang)
        || voices.find((v) => (v.lang || '').toLowerCase().startsWith('en'))
        || null;
    } catch (_) { /* leave default voice */ }
  }

  busy() { return !!this.current || this.queue.length > 0; }

  speak(text, kind = 'normal') {
    if (!this.supported && !(this.cloud && this.player)) { this._log('unsupported', text); return false; }
    const item = { text, kind, t: this.now() };
    if (kind === 'normal') {
      const was = this.said.get(text);
      if (was != null && item.t - was < this.dupMs) { this._log('dropped-duplicate', text); return false; }
    }
    if (kind === 'urgent') {
      // Drop queued routine alerts, jump the queue, and cut off a routine message in progress.
      this.queue = this.queue.filter((q) => q.kind !== 'normal');
      this.queue.unshift(item);
      if (this.current && this.current.kind !== 'urgent') this._cancelCurrent();
    } else if (kind === 'nav') {
      this.queue = this.queue.filter((q) => q.kind !== 'normal');
      let i = 0;
      while (i < this.queue.length && (this.queue[i].kind === 'urgent' || this.queue[i].kind === 'nav')) i++;
      this.queue.splice(i, 0, item);
      if (this.current && this.current.kind === 'normal') this._cancelCurrent();
    } else if (kind === 'normal') {
      const queuedNormal = this.queue.filter((q) => q.kind === 'normal').length;
      if (queuedNormal >= this.maxNormalQueued) {
        const i = this.queue.findIndex((q) => q.kind === 'normal');
        this._log('dropped-overflow', this.queue[i].text);
        this.queue.splice(i, 1);
      }
      this.queue.push(item);
    } else {
      // An answer to what the walker just asked goes before a message that was cut off to let them speak.
      const r = this.queue.findIndex((q) => q.resume);
      if (r >= 0) this.queue.splice(r, 0, item); else this.queue.push(item);
    }
    this._pump();
    return true;
  }

  // Quiet the app so the walker can speak: drop routine alerts and stop a routine message in progress.
  // Queued status, navigation and urgent messages are kept (an error or a route summary must not be lost); an urgent
  // or navigation message already playing finishes.
  // The walker has tapped Talk: stop speaking at once so they can be heard (and the mic does not hear us).
  // A turn prompt that was cut off goes back to the front and is spoken after. A cut-off status message is dropped (say "repeat").
  hush() {
    this.queue = this.queue.filter((q) => q.kind !== 'normal');
    const cur = this.current;
    if (cur && cur.kind !== 'urgent') {
      this._cancelCurrent();
      if (cur.kind === 'nav') { cur.resume = true; this.queue.unshift(cur); } // a turn prompt must not be lost; anything else, the walker can ask to repeat
    }
  }

  // The walker answered a question the app was still asking: stop reading it out and do not come back to it.
  // Turn prompts and urgent warnings are kept.
  skip() {
    this.queue = this.queue.filter((q) => q.kind !== 'normal' && q.kind !== 'status');
    if (this.current && this.current.kind !== 'urgent' && this.current.kind !== 'nav') this._cancelCurrent();
    this._pump();
  }

  // While held, only urgent warnings are spoken; the rest wait in the queue. Release when listening ends.
  hold(on) {
    this.held = !!on;
    if (!this.held) this._pump();
  }

  cancelAll() {
    this.queue = [];
    this._cancelCurrent();
  }

  _cancelCurrent() {
    const cur = this.current;
    this.current = null;
    if (this.watchdog) { this.clearTimer(this.watchdog); this.watchdog = null; }
    if (cur) this._log('cancelled', cur.text);
    if (this.playing) { try { this.playing.stop(); } catch (_) { /* ignore */ } this.playing = null; }
    try { this.synth.cancel(); } catch (_) { /* ignore */ }
  }

  _pump() {
    if (this.current) return;
    const now = this.now();
    while (this.queue.length) {
      if (this.held) {
        const u = this.queue.findIndex((q) => q.kind === 'urgent');
        if (u < 0) return;
        this._start(this.queue.splice(u, 1)[0]);
        return;
      }
      const item = this.queue.shift();
      if (item.kind === 'normal' && now - item.t > this.staleMs) { this._log('dropped-stale', item.text); continue; }
      this._start(item);
      return;
    }
  }

  _start(item) {
    this.current = item;
    if (item.kind === 'normal') this.said.set(item.text, this.now());
    this._log('speak', item.text, item.kind);
    if (this.onSpoken) this.onSpoken(item);
    const c = this.cloud && this.player ? this.cloud : null;
    if (c) {
      const url = c.cached(item.text, this.rate);
      if (url) { this._playCloud(item, url); return; }
      if (c.usable && item.kind !== 'urgent') {
        c.fetch(item.text, this.rate).then(
          (u) => { if (this.current === item) this._playCloud(item, u); },
          () => { if (this.current === item) this._phone(item); },
        );
        return;
      }
      if (c.usable) c.fetch(item.text, this.rate).catch(() => {}); // urgent: phone voice now, Google's ready for next time
    }
    this._phone(item);
  }

  _finish(item, why) {
    if (this.current !== item) return; // already cancelled or replaced
    this.current = null;
    this.playing = null;
    if (this.watchdog) { this.clearTimer(this.watchdog); this.watchdog = null; }
    this.lastEnd = this.now();
    if (why === 'error') this.errors += 1;
    this._pump();
    if (!this.current && this.onIdle) this.onIdle();
  }

  // Android Chrome sometimes never fires onend; do not let the queue freeze.
  _guard(item, perChar = 110) {
    if (this.watchdog) this.clearTimer(this.watchdog);
    const budget = 2000 + item.text.length * perChar / Math.min(1, this.rate || 1);
    this.watchdog = this.setTimer(() => { this._log('watchdog', item.text); this._finish(item, 'end'); }, budget);
  }

  _playCloud(item, url) {
    this.lastVoice = 'google';
    this._guard(item, 130);
    let failed = false;
    try {
      this.playing = this.player(url, () => this._finish(item, 'end'), () => {
        if (failed || this.current !== item) return;
        failed = true; this.playing = null; this._log('cloud-play-error', item.text); this._phone(item); // the phone says it instead
      });
    } catch (_) { this.playing = null; this._phone(item); }
  }

  _phone(item) {
    this.lastVoice = 'phone';
    this.pickVoice();
    if (!this.supported) { this._finish(item, 'error'); return; }
    const u = new this.Utterance(item.text);
    u.rate = this.rate;
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.onend = () => this._finish(item, 'end');
    u.onerror = () => this._finish(item, 'error');
    this._guard(item);
    try { this.synth.speak(u); } catch (e) { this._log('speak-error', String(e)); this._finish(item, 'error'); }
  }

  _log(event, text, kind) {
    this.log.push({ t: this.now(), event, text, kind });
    if (this.log.length > 300) this.log.shift();
  }
}
