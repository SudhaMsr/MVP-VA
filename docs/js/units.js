// How distances are spoken: metres (default) or steps. Blind walkers in the research asked for steps; the default stays
// metres because a step length differs from person to person (0.7 m is an average, set in STEP_METRES).
// One shared setting, so navigation prompts, hazard alerts and scene descriptions always agree.
export const STEP_METRES = 0.7;
export const UNIT_MODES = ['metres', 'steps'];
let mode = 'metres';

export const getUnits = () => mode;
export function setUnits(m) { if (UNIT_MODES.includes(m)) mode = m; return mode; }

// Route distances: "a few metres", "40 metres", "150 metres" - or the same in steps.
export function roundDistance(m) {
  if (mode === 'steps') {
    const s = m / STEP_METRES;
    if (s < 8) return 'a few steps';
    if (s < 30) return `${Math.round(s / 5) * 5} steps`;
    if (s < 200) return `${Math.round(s / 10) * 10} steps`;
    return `${Math.round(s / 50) * 50} steps`;
  }
  if (m < 15) return 'a few metres';
  if (m < 100) return `${Math.round(m / 10) * 10} metres`;
  return `${Math.round(m / 50) * 50} metres`;
}

// Hazard distances, which are short and estimated from the camera: "very close", "about 2 metres", "about 3 steps".
export function nearDistance(d) {
  if (d < 1.5) return 'very close';
  const n = mode === 'steps' ? Math.max(2, Math.round(d / STEP_METRES)) : Math.round(d);
  const unit = mode === 'steps' ? 'step' : 'metre';
  return `about ${n} ${n === 1 ? unit : unit + 's'}`;
}
