// Four short sounds, and a buzz for urgent alerts. Each sound has one meaning and is never used for anything else:
//   listen - rising two tones: I am listening, speak now
//   ok     - one clear tone: I understood / started
//   huh    - falling two tones: I did not hear or understand you
//   urgent - one sharp beep, with a buzz: danger alert follows
// Sounds are made with the Web Audio API (nothing to download). The audio context can only start after a tap, so
// unlock() is called from tap handlers; before that, play() is silently skipped.
const TONES = {
  listen: [[660, 0, 0.09], [880, 0.1, 0.12]],
  ok: [[880, 0, 0.16]],
  huh: [[330, 0, 0.12], [247, 0.14, 0.18]],
  urgent: [[1040, 0, 0.12]],
};

export class Cues {
  constructor({ AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null,
    vibrate = (typeof navigator !== 'undefined' && navigator.vibrate ? (p) => navigator.vibrate(p) : null), volume = 0.25 } = {}) {
    this.AudioCtx = AudioCtx;
    this.vibrate = vibrate;
    this.volume = volume;
    this.ctx = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.AudioCtx) return false;
    try {
      if (!this.ctx) this.ctx = new this.AudioCtx();
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      return true;
    } catch (_) { return false; }
  }

  play(name) {
    if (!this.enabled || !TONES[name]) return false;
    if (name === 'urgent' && this.vibrate) { try { this.vibrate([180, 80, 180]); } catch (_) { /* not supported */ } }
    if (name === 'listen' && this.vibrate) { try { this.vibrate(40); } catch (_) { /* not supported */ } }
    if (!this.ctx || this.ctx.state === 'closed') return false;
    try {
      const t0 = this.ctx.currentTime;
      for (const [freq, at, dur] of TONES[name]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0 + at);
        gain.gain.linearRampToValueAtTime(this.volume, t0 + at + 0.01);
        gain.gain.linearRampToValueAtTime(0, t0 + at + dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.02);
      }
      return true;
    } catch (_) { return false; }
  }
}
