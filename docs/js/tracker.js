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
      const tr = { id: this.nextId++, cls: d.cls, name: d.name, hits: 0, dist: null, speed: null, lastT: null, cx: null, latT: null, lat: null };
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
    // Sideways motion in the picture, in frame-widths per second (positive = moving right). Works for any class, with or without
    // a distance. A parked car seen while walking drifts only slowly; a car driving across the picture moves much faster.
    const cx = (d.x1 + d.x2) / 2 / frameW;
    if (tr.cx != null && tr.latT != null) {
      const dtl = (tMs - tr.latT) / 1000;
      if (dtl >= 0.05 && dtl <= 1.5) {
        const instl = (cx - tr.cx) / dtl;
        tr.lat = tr.lat == null ? instl : 0.4 * instl + 0.6 * tr.lat;
      } else {
        tr.lat = null;
      }
    }
    tr.cx = cx; tr.latT = tMs;
    // Cut off by the edge of the picture (field test 31 Oct): its width grows as more of it comes into view, which looked like
    // a parked car "approaching" and a fast-moving one "passing". While it touches the edge, speed and sideways motion are not
    // measured, and the count of good speed samples starts again.
    const m = Math.max(2, frameW * 0.01);
    tr.edge = d.x1 <= m || d.x2 >= frameW - m;
    if (tr.edge) tr.lat = null;
    const raw = estimateDistance(d, frameW, this.hfovDeg, frameH);
    if (raw == null) { tr.dist = null; tr.speed = null; return; }
    const prev = tr.dist;
    const dist = prev == null ? raw : 0.6 * raw + 0.4 * prev;
    if (tr.edge) { tr.dist = dist; tr.speed = null; tr.speedN = 0; tr.lastT = null; tr.hist = []; return; }
    // Closing speed = the slope of a straight line fitted through the last ~1.2 s of raw distances (field test 31 Oct).
    // A car really coming closer gives a steady fall (a good fit); a parked car whose box wobbles (camera shake, half hidden
    // behind another car) gives a poor fit, and its speed is not trusted. Positive = getting closer.
    tr.hist = (tr.hist || []).filter((h) => tMs - h[0] <= 1200);
    // A sudden jump in one step (over 30% and over 2 m) is the tracker swapping between two neighbouring parked cars, not
    // motion: even a car at 10 m/s, 5 m away, changes about 25% between frames. Start the speed measurement again.
    const last = tr.hist.length ? tr.hist[tr.hist.length - 1][1] : null;
    if (last != null && Math.abs(raw - last) > Math.max(2, 0.3 * last)) tr.hist = [];
    tr.hist.push([tMs, raw]);
    tr.speedN = tr.hist.length;
    const span = tMs - tr.hist[0][0];
    if (tr.hist.length >= 5 && span >= 500) {
      const n = tr.hist.length, mt = tr.hist.reduce((a, h) => a + h[0], 0) / n, md = tr.hist.reduce((a, h) => a + h[1], 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (const [t, d] of tr.hist) { sxy += (t - mt) * (d - md); sxx += (t - mt) ** 2; syy += (d - md) ** 2; }
      const slope = sxx ? sxy / sxx : 0; // metres per ms
      const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
      const sp = -slope * 1000;
      tr.speed = Math.abs(sp) > 25 ? null : (r2 >= 0.6 || Math.abs(sp) < 0.5 ? sp : null);
      tr.fit = +r2.toFixed(2);
    } else {
      tr.speed = null;
    }
    tr.dist = dist;
    tr.lastT = tMs;
  }
}
