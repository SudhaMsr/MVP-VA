// rod4b cues (test link ?slow=rod4). The slow lane's new classes (config.js ROD4) are spoken as a short hedge, never as a
// fact and never with a distance: "Possible kerb ahead, left. Check with your cane." A class must score at least its
// minScore in two slow runs in a row (confirmSlow), be in the walking path and low in the picture, and is then spoken once
// per encounter inside the normal talk budget (alerts.js). Priority 2, kind 'weak': so quiet mode never speaks them.
import { directionOf, inCorridor } from './alerts.js';
import { canonical } from './config.js';
import { confirmSlow, filterAllowed } from './lanes.js';

export function rod4Rules(speak) {
  return Object.fromEntries(Object.entries(speak).map(([n, r]) => [n, { minScore: r.minScore, runs: 2 }]));
}

// dets: everything the slow lane saw this run. Returns { dets: confirmed speakable detections, names: to pass back next run }.
export function rod4Confirm(dets, prevNames, speak) {
  return confirmSlow(filterAllowed(dets, Object.keys(speak)), prevNames, rod4Rules(speak));
}

export function rod4Text(name, dir, speak) {
  const r = speak[name];
  if (!r) return null;
  return `Possible ${r.noun} ahead${dir === 'ahead' ? '' : `, ${dir}`}. ${r.tail}`;
}

export function rod4Candidates(dets, frameW, frameH, speak, { corridor, nearBottom = 0.55 } = {}) {
  const out = [];
  for (const d of dets || []) {
    const name = canonical(d.name);
    if (!speak[name]) continue;
    const box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    if (box.y2 / frameH < nearBottom || !inCorridor(box, frameW, frameH, corridor)) continue;
    const dir = directionOf((d.x1 + d.x2) / 2, frameW);
    out.push({ key: `r4:${name}:${dir}`, text: rod4Text(name, dir, speak), priority: 2, kind: 'weak', once: true,
      dir, d: null, inPath: true, name: d.name, sp: null, score: d.score ?? null, hazard: true });
  }
  return out;
}
