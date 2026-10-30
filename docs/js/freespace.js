// Free-space guidance: which part of the walker's path is blocked, and which side is clearer.
// The picture is split into three lanes inside the walking corridor. Each lane's "blocked" level is smoothed over frames, so
// the advice does not flicker ("Oscillating commands cause disorientation"). Pure logic, no browser needed.
import { CONFIG } from './config.js';

export const LANES = { left: [0.18, 0.40], centre: [0.40, 0.60], right: [0.60, 0.82] };
const BLOCKERS = new Set(['person', 'dog', 'bicycle', 'car', 'truck', 'bus', 'motorcycle', 'tricycle', 'pole', 'ashcan',
  'warning_column', 'reflective_cone', 'roadblock', 'tree', 'guard_rail', 'bench', 'chair', 'plant_pot', 'electrical_box',
  'bicycle_rack', 'stairs', 'manhole']);

export class FreeSpace {
  constructor(cfg = CONFIG) {
    this.cfg = cfg.freeSpace || { nearMetres: 3.5, on: 0.6, off: 0.3, alpha: 0.4, clearFrames: 10 };
    this.level = { left: 0, centre: 0, right: 0 }; // smoothed 0..1
    this.blocked = { left: false, centre: false, right: false };
    this.cx = 0.5;
    this.inst = { left: false, centre: false, right: false }; // this frame only, used for the first thing we say
    this.clearRun = 0; // frames the centre has been clear since it was blocked
    this.announcedBlocked = false; // we told the walker it was blocked, so we owe them a "clear ahead"
  }

  // Does this thing block this lane right now? Near things only; a far object is not in the way yet.
  static blocks(tr, lane, W, H, cfg) {
    if (!BLOCKERS.has(tr.name)) return false;
    const bottom = tr.box.y2 / H, hFrac = (tr.box.y2 - tr.box.y1) / H;
    const near = tr.dist != null ? tr.dist < cfg.nearMetres : (hFrac > (CONFIG.staticNearFraction ?? 0.45) || bottom > 0.85);
    if (!near) return false;
    const [a, b] = LANES[lane];
    return tr.box.x2 / W > a && tr.box.x1 / W < b;
  }

  update(tracks, W, H) {
    const c = this.cfg;
    for (const lane of Object.keys(LANES)) {
      const now = tracks.some((tr) => FreeSpace.blocks(tr, lane, W, H, c)) ? 1 : 0;
      this.inst[lane] = now === 1;
      if (lane === 'centre') { const xs = tracks.filter((tr) => FreeSpace.blocks(tr, 'centre', W, H, c)).map((tr) => (tr.box.x1 + tr.box.x2) / 2 / W); this.cx = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5; }
      this.level[lane] += c.alpha * (now - this.level[lane]);
      if (!this.blocked[lane] && this.level[lane] >= c.on) this.blocked[lane] = true;
      else if (this.blocked[lane] && this.level[lane] <= c.off) this.blocked[lane] = false;
    }
    if (this.blocked.centre) this.clearRun = 0; else this.clearRun += 1;
    return this.advice();
  }

  // What to tell the walker when the way ahead is blocked. null when it is not.
  // The first announcement cannot wait for the smoothing, so it may use this frame's picture (instant = true).
  advice(instant = false) {
    const st = this.blocked.centre || !instant ? this.blocked : this.inst;
    if (!st.centre) return null;
    const { left, right } = st;
    if (left && right) return { side: null, stop: true, text: 'No clear way. Stop.' };
    if (!left && !right) {
      // both sides open: go round the side the obstacle is not on; if it is dead centre, the side that has been calmer
      const side = Math.abs(this.cx - 0.5) > 0.04 ? (this.cx < 0.5 ? 'right' : 'left') : (this.level.left <= this.level.right ? 'left' : 'right');
      return { side, stop: false, text: `Clearer on the ${side}.` };
    }
    const side = left ? 'right' : 'left';
    return { side, stop: false, text: `Clearer on the ${side}.` };
  }

  // Said once, after a blocked warning, when the way ahead has stayed clear for a moment.
  // peekClear() only looks; call spokenClear() once it has really been said, so a message that lost out to a hazard is kept.
  peekClear() {
    return this.announcedBlocked && !this.blocked.centre && this.clearRun >= (this.cfg.clearFrames ?? 10) ? 'Clear ahead.' : null;
  }
  spokenClear() { this.announcedBlocked = false; }

  reset() { this.level = { left: 0, centre: 0, right: 0 }; this.blocked = { left: false, centre: false, right: false }; this.clearRun = 0; this.announcedBlocked = false; }
}
