// Vibration cues (Package D: one distinct pattern per meaning, so a walker can tell them apart without listening).
// Speech can be hard to hear in traffic; a buzz is not. Patterns are [on, off, on, ...] in milliseconds.
export const VEHICLE = [250, 100, 250, 100, 250]; // a dangerous vehicle: three long, fast
export const STOP = [700]; // no clear way: one long buzz
export const STAIRS = [150, 90, 150]; // a fall hazard: two medium
export const OBSTACLE = [80, 120, 80, 120, 80]; // something in your path: three short
export const TURN_LEFT = [120]; // turn left now: one short
export const TURN_RIGHT = [120, 150, 120]; // turn right now: two short
export const ARRIVED = [60, 80, 60, 80, 400]; // near your destination: two taps and a long one
export const LOST_SIGNAL = [400, 200, 100]; // location signal lost: long then short

export const PATTERNS = {
  urgent: VEHICLE, stop: STOP, stairs: STAIRS, obstacle: OBSTACLE,
  turn_left: TURN_LEFT, turn_right: TURN_RIGHT, turn: TURN_LEFT, arrived: ARRIVED, lost: LOST_SIGNAL,
};

export class Haptics {
  constructor(vibrate = (typeof navigator !== 'undefined' && navigator.vibrate ? (p) => navigator.vibrate(p) : null), enabled = true) {
    this.vibrate = vibrate; this.enabled = enabled; this.last = 0;
  }
  get available() { return typeof this.vibrate === 'function'; }
  set(on) { this.enabled = !!on; return this.enabled; }
  buzz(kind, now = Date.now()) {
    if (!this.enabled || !this.available || !PATTERNS[kind]) return false;
    if (now - this.last < 1500 && kind !== 'urgent') return false; // never a stream of buzzes (a vehicle warning always gets through)
    this.last = now;
    try { return this.vibrate(PATTERNS[kind]) !== false; } catch (_) { return false; }
  }
  // Which buzz (if any) goes with a hazard alert. In vibration-only mode every alert needs one (obstacle, if nothing more
  // specific), because it is not spoken.
  static kindFor(alert, mode = 'both') {
    if (!alert) return null;
    if (alert.urgent) return 'urgent';
    if (/No clear way\. Stop\.$/.test(alert.text)) return 'stop';
    if (/^stairs:/.test(alert.key || '')) return 'stairs';
    return mode === 'vibration' ? 'obstacle' : null;
  }
  // Which buzz goes with a navigation or status line: turns, arrival, lost signal.
  static kindForNav(text) {
    const t = String(text || '');
    if (/^I lost your location signal/.test(t)) return 'lost';
    if (/\b(?:near your destination|have arrived)\b/i.test(t)) return 'arrived';
    const m = t.match(/^(.*?)\bnow\b/); // "Turn right now, then turn left ...": the turn to make now comes first
    if (!m) return null;
    if (/\bleft\b/i.test(m[1])) return 'turn_left';
    if (/\bright\b/i.test(m[1])) return 'turn_right';
    return null;
  }
}
