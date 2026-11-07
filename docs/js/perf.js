// Walk measurements (Package C, 7 Nov): what the Stage 1 gate and the "Our numbers" page need from every walk.
// Pure logic with plain numbers, so it is tested without a browser. The frame loop only adds to counters here: nothing
// is allocated per frame.

// Frames per second of the main lane, and average inference time per lane, over each reporting period (30 s).
export class PerfMeter {
  constructor(lanes = ['main', 'rod2', 'coco', 'hazard']) {
    this.lanes = lanes;
    this.sum = {}; this.n = {};
    this.reset(0);
  }
  reset(now) { this.since = now; this.frames = 0; for (const l of this.lanes) { this.sum[l] = 0; this.n[l] = 0; } }
  frame() { this.frames += 1; }
  lane(name, ms) { if (name in this.sum) { this.sum[name] += ms; this.n[name] += 1; } }
  // The figures since the last snapshot, then start a new period. ms per lane is null when the lane did not run.
  snapshot(now) {
    const secs = Math.max(0.001, (now - this.since) / 1000);
    const ms = {};
    for (const l of this.lanes) ms[l] = this.n[l] ? Math.round(this.sum[l] / this.n[l]) : null;
    const out = { fps: Math.round((this.frames / secs) * 10) / 10, ms, secs: Math.round(secs) };
    this.reset(now);
    return out;
  }
}

// Slow-phone mode. If the main lane stays under slowFps for slowMs, the extra lanes run less often (the caller doubles the
// rod2 and coco intervals and skips the hazard lane) so the main lane, which carries every vehicle warning, keeps its pace.
// Back to normal once it stays above fastFps for fastMs. update() returns 'slow' or 'normal' on a change, else null.
export const SLOW_TEXT = 'The phone is running slowly, so I am checking less often.';
export class SlowMode {
  constructor({ slowFps = 4, slowMs = 20000, fastFps = 6, fastMs = 30000 } = {}) {
    Object.assign(this, { slowFps, slowMs, fastFps, fastMs });
    this.slow = false; this.belowSince = null; this.aboveSince = null; this.said = false;
  }
  update(fps, now) {
    if (fps == null || Number.isNaN(fps)) return null;
    if (!this.slow) {
      if (fps < this.slowFps) { if (this.belowSince == null) this.belowSince = now; } else this.belowSince = null;
      if (this.belowSince != null && now - this.belowSince >= this.slowMs) { this.slow = true; this.aboveSince = null; return 'slow'; }
    } else {
      if (fps > this.fastFps) { if (this.aboveSince == null) this.aboveSince = now; } else this.aboveSince = null;
      if (this.aboveSince != null && now - this.aboveSince >= this.fastMs) { this.slow = false; this.belowSince = null; return 'normal'; }
    }
    return null;
  }
  // How often a lane runs now: the normal interval, doubled in slow mode. Infinity = skip (the hazard lane).
  every(ms, skipWhenSlow = false) { return !this.slow ? ms : skipWhenSlow ? Infinity : ms * 2; }
  // The spoken line, once per walk.
  announce() { if (this.said) return ''; this.said = true; return SLOW_TEXT; }
  reset() { this.slow = false; this.belowSince = null; this.aboveSince = null; this.said = false; }
}

// One walk, from start to stop: the walk summary event and the "walk summary" answer.
const VEHICLE_WORDS = /\b(car|bus|lorry|truck|motorbike|motorcycle|vehicle|van)\b/i;
export class WalkStats {
  constructor() { this.startedAt = null; this.endedAt = null; this.alerts = 0; this.vehicles = 0; this.fpsSum = 0; this.fpsN = 0; this.battery0 = null; this.battery1 = null; this.charged = false; }
  start(now, battery = null) { Object.assign(this, new WalkStats()); this.startedAt = now; this.battery0 = battery; }
  alert(text, priority) { this.alerts += 1; if (priority === 0 || VEHICLE_WORDS.test(text)) this.vehicles += 1; }
  perf(fps, battery = null, charging = false) {
    if (fps != null) { this.fpsSum += fps; this.fpsN += 1; }
    if (battery != null) { if (this.battery0 == null) this.battery0 = battery; this.battery1 = battery; }
    if (charging) this.charged = true;
  }
  stop(now, battery = null) { this.endedAt = now; if (battery != null) this.battery1 = battery; }
  summary(now) {
    if (this.startedAt == null) return null;
    const end = this.endedAt ?? now;
    const minutes = Math.round(((end - this.startedAt) / 60000) * 10) / 10;
    const used = !this.charged && this.battery0 != null && this.battery1 != null ? Math.round((this.battery0 - this.battery1) * 100) : null;
    return { minutes, alerts: this.alerts, vehicles: this.vehicles, fps: this.fpsN ? Math.round((this.fpsSum / this.fpsN) * 10) / 10 : null, batteryUsed: used };
  }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "Walk summary": spoken plainly, numbers rounded.
export function summaryText(s) {
  if (!s) return 'No walk yet. Tap start, and ask again after walking.';
  const mins = Math.max(0, Math.round(s.minutes));
  const parts = [`${mins < 1 ? 'Under a minute' : plural(mins, 'minute')}.`, `${plural(s.alerts, 'warning')} spoken, ${s.vehicles} about vehicles.`];
  if (s.fps != null) parts.push(`About ${Math.round(s.fps)} checks a second.`);
  parts.push(s.batteryUsed == null ? 'Battery use not known.' : `Battery used: ${Math.max(0, s.batteryUsed)} percent.`);
  return `Walk summary. ${parts.join(' ')}`;
}
