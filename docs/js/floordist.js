// Distance from where an object meets the ground (Package F), instead of from how big its box is.
// The camera is camHeight metres above the pavement, tilted down by pitch degrees. A point on the ground that appears
// angleBelowCentre degrees below the middle of the picture is seen at (pitch + that angle) below the horizon, so it is
// camHeight / tan(pitch + angle) metres away. The box's bottom edge is where the object stands.
// Experimental: behind ?dist=floor (see app.js). Both estimates are logged for every alert, so the error of each can be
// measured from real walks (tools/score_walk.mjs compare) before it is ever switched on for everyone.
export const FLOOR_DEFAULTS = { vfovDeg: 60, edgeMargin: 0.02, minAngleDeg: 2, heightShare: 0.72 };

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Degrees below the middle of the picture for a row y (negative above the middle).
export function angleBelowCentre(y, frameH, vfovDeg = FLOOR_DEFAULTS.vfovDeg) {
  const f = (frameH / 2) / Math.tan(rad(vfovDeg) / 2);
  return deg(Math.atan((y - frameH / 2) / f));
}

// Phone pitch below the horizon, from DeviceOrientationEvent beta, for a phone held upright (portrait), screen facing the
// walker: beta 90 = upright (camera level), beta 70 = tilted 20 degrees down. null when unknown.
export function pitchFromBeta(beta) { return beta == null || Number.isNaN(beta) ? null : 90 - beta; }

// Metres, or null when it cannot be trusted: the box bottom touches the frame edge (the object's foot is out of view), the
// pitch or height is unknown, or the ground point is at or above the horizon.
export function floorDistance({ yBottom, frameH, pitchDeg, camHeightM, vfovDeg = FLOOR_DEFAULTS.vfovDeg, edgeMargin = FLOOR_DEFAULTS.edgeMargin, minAngleDeg = FLOOR_DEFAULTS.minAngleDeg }) {
  if (pitchDeg == null || !(camHeightM > 0) || !(frameH > 0) || yBottom == null) return null;
  if (yBottom >= frameH * (1 - edgeMargin)) return null;
  const a = pitchDeg + angleBelowCentre(yBottom, frameH, vfovDeg);
  if (a < minAngleDeg || a >= 89) return null;
  return camHeightM / Math.tan(rad(a));
}

// The walker's height, said in feet and inches or in centimetres (or metres): "5 foot 8", "five feet eight inches",
// "173 centimetres", "1.73 metres", "6 foot". Centimetres, or null when it is not a believable adult or child height.
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, zero: 0 };
export function parseHeight(raw) {
  const t = String(raw || '').toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|zero)\b/g, (w) => String(NUM[w])).replace(/[,]/g, ' ');
  let cm = null;
  const ft = t.match(/(\d+(?:\.\d+)?)\s*(?:foot|feet|ft|')\s*(?:and\s*)?(\d+(?:\.\d+)?)?\s*(?:inches|inch|in|")?/);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:metres?|meters?|m)\b/);
  const c = t.match(/(\d+(?:\.\d+)?)\s*(?:centimetres?|centimeters?|cms?)\b/);
  if (ft) cm = (parseFloat(ft[1]) * 12 + (ft[2] ? parseFloat(ft[2]) : 0)) * 2.54;
  else if (c) cm = parseFloat(c[1]);
  else if (m) cm = parseFloat(m[1]) * 100;
  else { const n = t.match(/^\s*(\d{3})\s*$/); if (n) cm = parseFloat(n[1]); }
  return cm != null && cm >= 90 && cm <= 230 ? Math.round(cm) : null;
}

// Camera height at chest level: about 0.72 of the walker's height.
export const cameraHeightM = (heightCm, share = FLOOR_DEFAULTS.heightShare) => Math.round(heightCm * share) / 100;

// "Calibrate": average the phone's pitch over 2 seconds while the walker holds it as they walk. done() returns the
// average pitch, or null when there were too few readings (no motion sensor, or the page cannot read it).
export class PitchCalibrator {
  constructor(ms = 2000) { this.ms = ms; this.samples = []; this.t0 = null; }
  start(now) { this.samples = []; this.t0 = now; }
  add(beta, now) { if (this.t0 != null && now - this.t0 <= this.ms) { const p = pitchFromBeta(beta); if (p != null) this.samples.push(p); } }
  done() { return this.samples.length >= 5 ? Math.round((this.samples.reduce((a, b) => a + b, 0) / this.samples.length) * 10) / 10 : null; }
}
