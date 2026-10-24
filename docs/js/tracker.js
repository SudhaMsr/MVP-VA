// Simple IoU tracker + distance / approach-speed estimates.
// Fixes the old prototype's crash: a brand-new track has no speed yet, and objects we cannot
// measure (poles, cones...) have no distance. Both are `null`, never missing keys.
import { iou } from './detector.js';
import { CONFIG } from './config.js';

// Typical real-world widths in metres (rough: used for "about N metres").
const REAL_WIDTH = {
  person: 0.5, car: 1.8, truck: 2.5, bus: 2.55, motorcycle: 0.8, bicycle: 0.6, tricycle: 1.2, dog: 0.4,
};

// hfovDeg is the field of view along the LONG side of the camera picture (about 66 degrees on most phones).
// Held upright, the picture is portrait (e.g. 480x640), so the long side is the height, not the width.
export function focalPx(frameW, hfovDeg, frameH = frameW) {
  return Math.max(frameW, frameH) / (2 * Math.tan((hfovDeg * Math.PI) / 360));
}

// Returns metres or null when the class has no size model or the box is too small to trust.
export function estimateDistance(det, frameW, hfovDeg = CONFIG.hfovDeg, frameH = frameW) {
  const W = REAL_WIDTH[det.name];
  const wPx = det.x2 - det.x1;
  if (!W || wPx < 8) return null;
  return (W * focalPx(frameW, hfovDeg, frameH)) / wPx;
}

export class Tracker {
  constructor(opts = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? CONFIG.trackMaxAgeMs;
    this.iouMin = opts.iouMin ?? CONFIG.trackIouMin;
    this.hfovDeg = opts.hfovDeg ?? CONFIG.hfovDeg;
    this.tracks = [];
    this.nextId = 1;
  }

  update(dets, tMs, frameW, frameH = frameW) {
    const pairs = [];
    this.tracks.forEach((tr, ti) => {
      dets.forEach((d, di) => {
        if (tr.cls !== d.cls) return;
        const v = iou(tr.box, d);
        if (v >= this.iouMin) pairs.push({ ti, di, v });
      });
    });
    pairs.sort((a, b) => b.v - a.v);
    const usedT = new Set(), usedD = new Set();
    const seen = [];

    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      usedT.add(p.ti); usedD.add(p.di);
      const tr = this.tracks[p.ti];
      this._apply(tr, dets[p.di], tMs, frameW, frameH);
      seen.push(tr);
    }
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const tr = { id: this.nextId++, cls: d.cls, name: d.name, hits: 0, dist: null, speed: null, lastT: null };
      this._apply(tr, d, tMs, frameW, frameH);
      this.tracks.push(tr);
      seen.push(tr);
    });
    this.tracks = this.tracks.filter((tr) => tMs - tr.seenAt <= this.maxAgeMs);
    return seen;
  }

  _apply(tr, d, tMs, frameW, frameH) {
    tr.box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    tr.score = d.score;
    tr.hits += 1;
    tr.seenAt = tMs;
    const raw = estimateDistance(d, frameW, this.hfovDeg, frameH);
    if (raw == null) { tr.dist = null; tr.speed = null; return; }
    const prev = tr.dist;
    const dist = prev == null ? raw : 0.6 * raw + 0.4 * prev;
    if (prev != null && tr.lastT != null) {
      const dt = (tMs - tr.lastT) / 1000;
      if (dt >= 0.05 && dt <= 1.5) {
        const inst = (prev - dist) / dt; // positive = getting closer
        const sp = tr.speed == null ? inst : 0.4 * inst + 0.6 * tr.speed;
        tr.speed = Math.abs(sp) > 25 ? null : sp;
      } else {
        tr.speed = null;
      }
    }
    tr.dist = dist;
    tr.lastT = tMs;
  }
}
