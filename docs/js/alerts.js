// Turns tracked objects into at most one short spoken alert per call.
// Priority 0 = urgent (interrupts), 1-2 = hazards, 3-4 = information (only when nothing else is in view).
import { CONFIG } from './config.js';

const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle', 'tricycle']);
const STATIC_OBSTACLES = {
  pole: 'Pole', ashcan: 'Bin', warning_column: 'Warning post', reflective_cone: 'Cone',
  roadblock: 'Barrier', tree: 'Tree', guard_rail: 'Barrier', bench: 'Bench', chair: 'Chair',
  plant_pot: 'Plant pot', electrical_box: 'Electrical box', bicycle_rack: 'Bicycle rack',
};
const STATIC_PRIORITY = { roadblock: 1, tree: 3, plant_pot: 3, bench: 3 }; // default 2
const LABEL = {
  car: 'Car', truck: 'Truck', bus: 'Bus', motorcycle: 'Motorbike', tricycle: 'Tricycle', bicycle: 'Bicycle',
  person: 'Person', dog: 'Dog',
};

export function directionOf(cx, frameW) {
  const f = cx / frameW;
  if (f < 1 / 3) return 'left';
  if (f > 2 / 3) return 'right';
  return 'ahead';
}

function metres(d) {
  if (d < 1.5) return 'very close';
  const n = Math.round(d);
  return `about ${n} ${n === 1 ? 'metre' : 'metres'}`;
}

export const LEVELS = ['quiet', 'normal', 'detailed'];

// Things a cane or guide dog finds anyway (poles, bins, benches, ...) are only spoken in 'detailed'.
// quiet: urgent and fall hazards (stairs, red lights, barriers), plus people, dogs and vehicles very close ahead.
// normal: everything except those static things.   detailed: everything.
export function levelAllows(a, level, quietNearMetres = 2) {
  if (level === 'detailed' || a.priority <= 1) return true;
  if (level === 'normal') return a.kind !== 'static';
  return a.kind === 'moving' && a.dir === 'ahead' && a.d != null && a.d < quietNearMetres; // quiet
}

export class AlertEngine {
  constructor(cfg = CONFIG, level = 'detailed') {
    this.cfg = cfg;
    this.level = level;
    this.last = new Map(); // key -> { t: time last spoken, d: distance then, n: repeats since it last got closer }
    this.spokenAt = []; // times of recent non-urgent alerts, for the budget
  }

  setLevel(level) { if (LEVELS.includes(level)) this.level = level; return this.level; }

  candidates(tracks, frameW, frameH) {
    const c = this.cfg;
    const out = [];
    for (const tr of tracks) {
      const start = out.length;
      const dir = directionOf((tr.box.x1 + tr.box.x2) / 2, frameW);
      const name = tr.name;
      const d = tr.dist; // number or null
      const sp = tr.speed; // number or null
      const hFrac = (tr.box.y2 - tr.box.y1) / frameH;
      const bottom = tr.box.y2 / frameH; // low in the picture = close to the camera, for things on the ground

      if (VEHICLES.has(name) || name === 'bicycle') {
        if (d == null) continue;
        const maxD = name === 'bicycle' ? 8 : c.vehicleAlertMetres;
        const approaching = sp != null && sp > c.approachSpeedMps && tr.hits >= c.approachMinHits;
        const veryNear = d < c.vehicleUrgentMetres && tr.hits >= 2; // one-frame wide boxes caused false alarms in the field log
        if ((approaching && d < maxD) || veryNear) {
          const text = approaching
            ? `Caution. ${LABEL[name]} approaching, ${dir}, ${metres(d)}.`
            : `Caution. ${LABEL[name]}, ${dir}, ${metres(d)}.`;
          out.push({ key: `${name}:${dir}:u`, text, priority: 0, still: !approaching });
        } else if (d < maxD) {
          out.push({ key: `${name}:${dir}`, text: `${LABEL[name]}, ${dir}, ${metres(d)}.`, priority: 2 });
        }
      } else if (name === 'person') {
        if (d != null && d < c.personNearMetres) {
          out.push({ key: `person:${dir}`, text: `Person, ${dir}, ${metres(d)}.`, priority: 2 });
        }
      } else if (name === 'dog') {
        if (d != null && d < c.dogNearMetres) {
          out.push({ key: `dog:${dir}`, text: `Dog, ${dir}, ${metres(d)}.`, priority: 2 });
        }
      } else if (name === 'stairs') {
        // A fall hazard: announce as soon as it is in the lower half of the picture.
        if (bottom > 0.5) {
          const near = bottom > 0.8 ? ', close' : '';
          out.push({ key: `stairs:${dir}`, text: `Stairs, ${dir}${near}.`, priority: 1 });
        }
      } else if (name === 'manhole') {
        if (bottom > 0.7) out.push({ key: `manhole:${dir}`, text: `Manhole, ${dir}, close.`, priority: 2 });
      } else if (STATIC_OBSTACLES[name]) {
        if (hFrac > c.staticNearFraction || bottom > 0.9) {
          const pr = STATIC_PRIORITY[name] ?? 2;
          out.push({ key: `${name}:${dir}`, text: `${STATIC_OBSTACLES[name]}, ${dir}, close.`, priority: pr });
        }
      } else if (name === 'red_light') {
        out.push({ key: `red:${dir}`, text: `Red light, ${dir}.`, priority: 1 });
      } else if (name === 'green_light') {
        out.push({ key: `green:${dir}`, text: `Green light, ${dir}.`, priority: 3 });
      } else if (name === 'crosswalk') {
        out.push({ key: `crosswalk:${dir}`, text: `Crossing, ${dir}.`, priority: 3 });
      } else if (name === 'blind_road') {
        out.push({ key: `tactile:${dir}`, text: `Tactile paving, ${dir}.`, priority: 4 });
      } else if (name === 'fire_hydrant' && hFrac > c.staticNearFraction) {
        out.push({ key: `hydrant:${dir}`, text: `Hydrant, ${dir}, close.`, priority: 4 });
      }
      // 'sign', 'building' and 'road' are ignored on purpose: we cannot read it yet, so announcing it is just noise.
      const kind = STATIC_OBSTACLES[name] || name === 'manhole' || name === 'fire_hydrant' || name === 'blind_road' ? 'static'
        : VEHICLES.has(name) || name === 'bicycle' || name === 'person' || name === 'dog' ? 'moving' : 'info';
      for (let i = start; i < out.length; i++) { out[i].d = d; out[i].dir = dir; out[i].kind = kind; }
    }
    // Only things near or in the walker's path are worth speaking about: off to the side, wait until they are close.
    // Urgent alerts and fall hazards (stairs, red lights) always stay.
    return out.filter((a) => levelAllows(a, this.level, c.quietNearMetres) &&
      (a.priority <= 1 || a.dir === 'ahead' || a.d == null || a.d < (c.sideAlertMetres ?? 2.5)));
  }

  // Returns {text, priority, urgent, key} or null.
  // A thing that is still there is not news: each repeat of the same alert waits longer (1x, 2x, 3x, 4x the cooldown)
  // unless it has got clearly closer. At most budgetMax routine alerts are spoken per budgetWindowMs; urgent ones are exempt.
  next(tracks, frameW, frameH, tMs) {
    const c = this.cfg;
    let cands = this.candidates(tracks, frameW, frameH);
    if (cands.some((x) => x.priority <= 2)) cands = cands.filter((x) => x.priority <= 2);
    cands.sort((a, b) => a.priority - b.priority);
    this.spokenAt = this.spokenAt.filter((t) => tMs - t < (c.budgetWindowMs ?? 10000));
    for (const a of cands) {
      const rec = this.last.get(a.key);
      const closer = rec && a.d != null && rec.d != null && rec.d - a.d >= (c.repeatCloserMetres ?? 1.5);
      let n = rec && !closer && tMs - rec.t < 30000 ? rec.n : 0;
      const base = a.still ? Math.max(c.cooldownMs[a.priority] ?? 10000, 6000) : (c.cooldownMs[a.priority] ?? 10000); // a near vehicle that is not closing in is not news every 3 s
      const cd = base * (1 + Math.min(n, 3));
      if (rec && !closer && tMs - rec.t < cd) continue;
      if (a.priority > 0 && this.spokenAt.length >= (c.budgetMax ?? 3)) continue;
      this.last.set(a.key, { t: tMs, d: a.d, n: rec && !closer ? n + 1 : 0 });
      if (a.priority > 0) this.spokenAt.push(tMs);
      return { ...a, urgent: a.priority === 0 };
    }
    return null;
  }

  reset() { this.last.clear(); this.spokenAt = []; }
}
