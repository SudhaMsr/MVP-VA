// Speech queue. Three kinds of message:
//   urgent - interrupts whatever is playing; never dropped
//   status - queued in order; never dropped (command feedback, errors, navigation)
//   normal - routine alerts; dropped if they have become stale or the queue is long
// The old prototype silently dropped everything while it was already speaking. This does not.
export class Speaker {
  constructor(synth, UtteranceCtor, opts = {}) {
    this.synth = synth;
    this.Utterance = UtteranceCtor;
    this.rate = opts.rate ?? 0.95;
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
    if (!this.supported) { this._log('unsupported', text); return false; }
    const item = { text, kind, t: this.now() };
    if (kind === 'urgent') {
      // Drop queued routine alerts, jump the queue, and cut off a routine message in progress.
      this.queue = this.queue.filter((q) => q.kind !== 'normal');
      this.queue.unshift(item);
      if (this.current && this.current.kind !== 'urgent') this._cancelCurrent();
    } else if (kind === 'normal') {
      const queuedNormal = this.queue.filter((q) => q.kind === 'normal').length;
      if (queuedNormal >= this.maxNormalQueued) {
        const i = this.queue.findIndex((q) => q.kind === 'normal');
        this._log('dropped-overflow', this.queue[i].text);
        this.queue.splice(i, 1);
      }
      this.queue.push(item);
    } else {
      this.queue.push(item);
    }
    this._pump();
    return true;
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
    try { this.synth.cancel(); } catch (_) { /* ignore */ }
  }

  _pump() {
    if (this.current) return;
    const now = this.now();
    while (this.queue.length) {
      const item = this.queue.shift();
      if (item.kind === 'normal' && now - item.t > this.staleMs) { this._log('dropped-stale', item.text); continue; }
      this._start(item);
      return;
    }
  }

  _start(item) {
    this.pickVoice();
    const u = new this.Utterance(item.text);
    u.rate = this.rate;
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    this.current = item;
    const finish = (why) => {
      if (this.current !== item) return; // already cancelled or replaced
      this.current = null;
      if (this.watchdog) { this.clearTimer(this.watchdog); this.watchdog = null; }
      this.lastEnd = this.now();
      if (why === 'error') this.errors += 1;
      this._pump();
    };
    u.onend = () => finish('end');
    u.onerror = () => finish('error');
    // Android Chrome sometimes never fires onend; do not let the queue freeze.
    const budget = 2000 + item.text.length * 110;
    this.watchdog = this.setTimer(() => { this._log('watchdog', item.text); finish('end'); }, budget);
    this._log('speak', item.text, item.kind);
    if (this.onSpoken) this.onSpoken(item);
    try { this.synth.speak(u); } catch (e) { this._log('speak-error', String(e)); finish('error'); }
  }

  _log(event, text, kind) {
    this.log.push({ t: this.now(), event, text, kind });
    if (this.log.length > 300) this.log.shift();
  }
}
