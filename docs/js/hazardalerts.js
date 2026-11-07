// Hazard lane goes live, class by class (Package E). The open-vocabulary hazard model (YOLOE, RNIB's obstacle list) is
// log-only until a class proves itself: precision >= 0.9 and recall >= 0.6 on at least 50 labelled examples
// (tools/phase4/graduate.mjs reads tools/phase4/eval_hazard_model.py's hazard_eval.json). Only classes listed in
// HAZARD.speakClasses are ever spoken, worded as a hedge ("Possible e-scooter ahead, left."), with no distance (none of
// these classes has a measured distance error yet), below moving vehicles and stairs, inside the normal alert budget,
// once per encounter.
import { directionOf, inCorridor } from './alerts.js';
import { canonical } from './config.js';

export const GRADUATION = { precision: 0.9, recall: 0.6, minExamples: 50 };
// Never spoken from this lane, whatever the numbers say: a "crossing light" from it could be heard as a signal reading.
export const NEVER_SPEAK = ['ped_signal'];

const NOUN = { e_scooter: 'e-scooter', bicycle: 'bicycle', a_board: 'A-board', bollard: 'bollard', wheelie_bin: 'wheelie bin',
  rubbish_bag: 'rubbish bag', traffic_cone: 'cone', reflective_cone: 'cone', road_barrier: 'roadworks barrier', low_branch: 'low branch',
  kerb: 'kerb', stairs: 'stairs', pothole: 'pothole', bench: 'bench', lamp_post: 'lamp post' };

// One line per class in hazard_eval.json: does it pass, and why not.
export function graduate(evalJson, rule = GRADUATION) {
  const out = [];
  for (const [name, r] of Object.entries((evalJson && evalJson.classes) || {})) {
    const examples = (r.tp ?? 0) + (r.fn ?? 0);
    const why = [];
    if (NEVER_SPEAK.includes(name)) why.push('never spoken from this lane');
    if (r.precision == null || r.precision < rule.precision) why.push(`precision ${r.precision ?? '-'} under ${rule.precision}`);
    if (r.recall == null || r.recall < rule.recall) why.push(`recall ${r.recall ?? '-'} under ${rule.recall}`);
    if (examples < rule.minExamples) why.push(`${examples} labelled examples, needs ${rule.minExamples}`);
    out.push({ name, pass: why.length === 0, precision: r.precision ?? null, recall: r.recall ?? null, examples, why });
  }
  return out.sort((a, b) => Number(b.pass) - Number(a.pass) || a.name.localeCompare(b.name));
}

export function hazardText(name, dir) {
  const n = NOUN[name] || String(name).replace(/_/g, ' ');
  return dir === 'ahead' ? `Possible ${n} ahead.` : `Possible ${n} ahead, ${dir}.`;
}

// Spoken candidates for the alert engine, from confirmed hazard-lane detections ({name, x1, y1, x2, y2, score}).
// Only graduated classes, only in the walking path and near (the bottom of the box low in the picture).
export function hazardCandidates(dets, frameW, frameH, speakClasses, { corridor, nearBottom = 0.55 } = {}) {
  const allowed = new Set((speakClasses || []).filter((c) => !NEVER_SPEAK.includes(c)).map(canonical));
  if (!allowed.size) return [];
  const out = [];
  for (const d of dets || []) {
    if (!allowed.has(canonical(d.name))) continue;
    const box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    if (box.y2 / frameH < nearBottom || !inCorridor(box, frameW, frameH, corridor)) continue;
    const dir = directionOf((d.x1 + d.x2) / 2, frameW);
    out.push({ key: `hz:${canonical(d.name)}:${dir}`, text: hazardText(canonical(d.name), dir), priority: 2, kind: 'hazard', once: true,
      dir, d: null, inPath: true, name: d.name, sp: null, score: d.score ?? null, hazard: true });
  }
  return out;
}
