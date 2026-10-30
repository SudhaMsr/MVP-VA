// Vibration cues for the moments that matter most. Speech can be hard to hear in traffic; a buzz is not.
// Kept deliberately small: urgent warnings, "no clear way", stairs, and "turn now". Everything else stays silent and still.
export const PATTERNS = {
  urgent: [250, 100, 250, 100, 250], // a dangerous vehicle
  stop: [700], // no clear way: one long buzz
  stairs: [150, 90, 150], // a fall hazard
  turn: [120], // "turn now": a short tap
};

export class Haptics {
  constructor(vibrate = (typeof navigator !== 'undefined' && navigator.vibrate ? (p) => navigator.vibrate(p) : null), enabled = true) {
    this.vibrate = vibrate; this.enabled = enabled; this.last = 0;
  }
  get available() { return typeof this.vibrate === 'function'; }
  set(on) { this.enabled = !!on; return this.enabled; }
  buzz(kind, now = Date.now()) {
    if (!this.enabled || !this.available || !PATTERNS[kind]) return false;
    if (now - this.last < 1500) return false; // never a stream of buzzes
    this.last = now;
    try { return this.vibrate(PATTERNS[kind]) !== false; } catch (_) { return false; }
  }
  // Which buzz (if any) goes with something we are about to say?
  static kindFor(alert) {
    if (!alert) return null;
    if (alert.urgent) return 'urgent';
    if (/No clear way\. Stop\.$/.test(alert.text)) return 'stop';
    if (/^stairs:/.test(alert.key || '')) return 'stairs';
    return null;
  }
}
