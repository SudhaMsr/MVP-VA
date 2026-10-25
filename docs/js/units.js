// How distances are spoken. Three modes:
//   miles  - the default for UK walkers: yards for short distances, miles for long ("50 yards", "0.3 miles")
//   metres - metres and kilometres
//   steps  - the walker's own steps (users in the research asked for steps). A step is taken as 70 cm unless the walker
//            sets their own ("my step is 60 centimetres"), so step counts are always approximate.
// One shared setting, so navigation prompts, hazard alerts and scene descriptions always agree.
// Numbers are rounded on purpose: "0.7 miles" is easier to take in, and to trust, than "1118 metres".
export const UNIT_MODES = ['miles', 'metres', 'steps'];
export const DEFAULT_UNITS = 'miles';
export const DEFAULT_STEP_METRES = 0.7;
export const STEP_LIMITS = [0.3, 1.2]; // metres: anything outside this is not a believable step
const YARD = 0.9144, MILE = 1609.344;

let mode = DEFAULT_UNITS;
let stepM = DEFAULT_STEP_METRES;

export const getUnits = () => mode;
export function setUnits(m) { if (UNIT_MODES.includes(m)) mode = m; return mode; }
export const getStep = () => stepM;
// Returns the step length now in use, or null if the value is not believable (and nothing changes).
export function setStep(metres) {
  if (!(metres >= STEP_LIMITS[0] && metres <= STEP_LIMITS[1])) return null;
  stepM = Math.round(metres * 100) / 100;
  return stepM;
}
export const stepCm = () => Math.round(stepM * 100);

// One decimal place, said as digits: "0.7 miles", "1.2 miles", "1 mile". Simple to hear and close to the real figure.
const decimal = (x) => { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
function milesPhrase(mi) {
  if (mi >= 10) return `${Math.round(mi)} miles`;
  const t = decimal(Math.max(mi, 0.1));
  return t === '1' ? '1 mile' : `${t} miles`;
}
function kmPhrase(km) {
  if (km >= 10) return `${Math.round(km)} kilometres`;
  const t = decimal(Math.max(km, 0.1));
  return t === '1' ? '1 kilometre' : `${t} kilometres`;
}

// Route distances: "a few yards", "40 yards", "0.3 miles" / "a few metres", "350 metres", "1.1 kilometres" / "60 steps".
export function roundDistance(m) {
  if (mode === 'steps') {
    const s = m / stepM;
    if (s < 8) return 'a few steps';
    if (s < 30) return `${Math.round(s / 5) * 5} steps`;
    if (s < 100) return `${Math.round(s / 10) * 10} steps`;
    if (s < 500) return `${Math.round(s / 50) * 50} steps`;
    if (s < 1000) return `${Math.round(s / 100) * 100} steps`;
    return milesPhrase(m / MILE); // nobody counts thousands of steps: over about 700 m, say it in miles
  }
  if (mode === 'metres') {
    if (m < 15) return 'a few metres';
    if (m < 100) return `${Math.round(m / 10) * 10} metres`;
    if (m < 950) return `${Math.round(m / 50) * 50} metres`;
    return kmPhrase(m / 1000);
  }
  const yd = m / YARD;
  if (yd < 15) return 'a few yards';
  if (yd < 100) return `${Math.round(yd / 10) * 10} yards`;
  if (yd < 400) return `${Math.round(yd / 50) * 50} yards`;
  return milesPhrase(m / MILE);
}

// Hazard distances, which are short and estimated from the camera: "very close", "about 2 yards", "about 3 steps".
export function nearDistance(d) {
  if (d < 1.5) return 'very close';
  const [n, unit] = mode === 'steps' ? [Math.max(2, Math.round(d / stepM)), 'step']
    : mode === 'metres' ? [Math.round(d), 'metre'] : [Math.max(2, Math.round(d / YARD)), 'yard'];
  return `about ${n} ${n === 1 ? unit : unit + 's'}`;
}

// "2 hours 10 minutes" style journey time, rounded so it is easy to take in: exact under 10 minutes, then to 5 minutes,
// then to the quarter hour. Walking estimates are never better than that.
export function durationPhrase(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins === 1) return 'about 1 minute';
  if (mins < 10) return `about ${mins} minutes`;
  if (mins < 58) return `about ${Math.round(mins / 5) * 5} minutes`;
  const q = Math.round(mins / 15); // quarter hours
  const h = Math.floor(q / 4);
  if (h >= 3) return `about ${Math.round(mins / 60)} hours`;
  const frac = ['', ' and a quarter', ' and a half', ' and three quarters'][q % 4];
  return `about ${h === 1 ? 'an hour' : `${h} hours`}${frac}`;
}
