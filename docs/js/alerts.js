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

export class AlertEngine {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.last = new Map(); // key -> time last spoken
  }

  candidates(tracks, frameW, frameH) {
    const c = this.cfg;
    const out = [];
    for (const tr of tracks) {
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
        if ((approaching && d < maxD) || d < c.vehicleUrgentMetres) {
          const text = approaching
            ? `Caution. ${LABEL[name]} approaching, ${dir}, ${metres(d)}.`
            : `Caution. ${LABEL[name]}, ${dir}, ${metres(d)}.`;
          out.push({ key: `${name}:${dir}:u`, text, priority: 0 });
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
    }
    return out;
  }

  // Returns {text, priority, urgent, key} or null.
  next(tracks, frameW, frameH, tMs) {
    let cands = this.candidates(tracks, frameW, frameH);
    if (cands.some((x) => x.priority <= 2)) cands = cands.filter((x) => x.priority <= 2);
    cands.sort((a, b) => a.priority - b.priority);
    for (const a of cands) {
      const cd = this.cfg.cooldownMs[a.priority] ?? 10000;
      const last = this.last.get(a.key);
      if (last != null && tMs - last < cd) continue;
      this.last.set(a.key, tMs);
      return { ...a, urgent: a.priority === 0 };
    }
    return null;
  }

  reset() { this.last.clear(); }
}
