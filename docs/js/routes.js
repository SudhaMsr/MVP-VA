// Record a walk, then follow it again (or back the way you came). Free, works with no internet, and needs no map:
// blind walkers repeat the same few routes, and their own recorded path is the most trustworthy one.
// Pure logic (no browser), so it is tested with plain numbers. The turn-by-turn guidance itself is done by Navigator.
import { haversine, bearing } from './nav.js';
import { normaliseName } from './places.js';

const MIN_STEP_M = 5; // a fix is kept only if it is at least this far from the last kept one
const MAX_ACCURACY_M = 30; // poor fixes are not recorded
const MAX_POINTS = 4000;
const WALK_SPEED_MPS = 1.2;

// Douglas-Peucker: drop points that lie within `tol` metres of the straight line between the kept ones.
function perpMetres(p, a, b) {
  const L = haversine(a, b);
  if (L < 0.5) return haversine(p, a);
  const t = ((p.lat - a.lat) * (b.lat - a.lat) + (p.lon - a.lon) * (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180) ** 2) /
    ((b.lat - a.lat) ** 2 + ((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2);
  const c = Math.max(0, Math.min(1, t));
  return haversine(p, { lat: a.lat + c * (b.lat - a.lat), lon: a.lon + c * (b.lon - a.lon) });
}
export function simplify(points, tol = 6) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false); keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let worst = 0, at = -1;
    for (let k = i + 1; k < j; k++) { const d = perpMetres(points[k], points[i], points[j]); if (d > worst) { worst = d; at = k; } }
    if (worst > tol && at > 0) { keep[at] = true; stack.push([i, at], [at, j]); }
  }
  return points.filter((_, i) => keep[i]);
}

const signedTurn = (a, b, c) => ((bearing(b, c) - bearing(a, b) + 540) % 360) - 180; // + = right

export function pathLength(points) { let d = 0; for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]); return d; }

// Turn a recorded path into the same kind of route Navigator already walks you along.
export function routeFromPoints(points, name = 'your route', { reverse = false, turnDeg = 35, tol = 6 } = {}) {
  let pts = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  if (reverse) pts = pts.reverse();
  if (pts.length < 2) return null;
  const v = simplify(pts, tol);
  // corners: where the path bends by more than turnDeg; the rest of the vertices are just curves in a straight-ish walk
  const idx = [0];
  for (let i = 1; i < v.length - 1; i++) if (Math.abs(signedTurn(v[i - 1], v[i], v[i + 1])) >= turnDeg) idx.push(i);
  idx.push(v.length - 1);
  const steps = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    const leg = v.slice(a, b + 1);
    let text = 'walk straight', type = 'depart';
    if (k > 0) {
      const turn = signedTurn(v[a - 1], v[a], v[a + 1]);
      type = 'turn';
      text = Math.abs(turn) > 150 ? 'turn around' : `turn ${turn > 0 ? 'right' : 'left'}`;
      if (Math.abs(turn) > 110 && Math.abs(turn) <= 150) text = `turn sharp ${turn > 0 ? 'right' : 'left'}`;
    }
    steps.push({ distance: pathLength(leg), name: '', text, maneuver: { type, location: [leg[0].lon, leg[0].lat] }, at: { lat: leg[0].lat, lon: leg[0].lon }, path: leg });
  }
  const end = v[v.length - 1];
  steps.push({ distance: 0, name: '', text: 'you have arrived', maneuver: { type: 'arrive', location: [end.lon, end.lat] }, at: { lat: end.lat, lon: end.lon }, path: [] });
  const distance = steps.reduce((s, x) => s + x.distance, 0);
  return { distance, duration: distance / WALK_SPEED_MPS, steps, source: 'recorded', start: v[0], end, name };
}

// ---- recording and storage ----
export class RouteStore {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null), key = 'va.routes') { this.storage = storage; this.key = key; this.mem = {}; }
  _load() { try { const raw = this.storage && this.storage.getItem(this.key); if (raw) return { ...this.mem, ...JSON.parse(raw) }; } catch (_) { /* unavailable */ } return { ...this.mem }; }
  _save(all) { this.mem = all; try { if (this.storage) { this.storage.setItem(this.key, JSON.stringify(all)); return true; } } catch (_) { /* memory only */ } return false; }
  save(rawName, points) {
    const name = normaliseName(rawName); if (!name || points.length < 2) return null;
    const all = this._load(); const replaced = !!all[name];
    all[name] = { name, points: points.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]), savedAt: Date.now() };
    this.last = name;
    return { name, replaced, persisted: this._save(all) };
  }
  get(rawName) {
    const r = this._load()[normaliseName(rawName)];
    return r ? { name: r.name, points: r.points.map(([lat, lon]) => ({ lat, lon })) } : null;
  }
  getLast() {
    const all = Object.values(this._load()); if (!all.length) return null;
    return this.get(all.sort((a, b) => b.savedAt - a.savedAt)[0].name);
  }
  list() { return Object.keys(this._load()).sort(); }
  remove(rawName) { const all = this._load(); const n = normaliseName(rawName); const had = !!all[n]; delete all[n]; this._save(all); return had; }
}

export class RouteRecorder {
  constructor() { this.active = false; this.name = ''; this.points = []; }
  start(name) { this.active = true; this.name = name; this.points = []; }
  // Returns true when the fix was kept.
  add(p) {
    if (!this.active || (p.accuracy != null && p.accuracy > MAX_ACCURACY_M)) return false;
    const last = this.points[this.points.length - 1];
    if (last && haversine(last, p) < MIN_STEP_M) return false;
    this.points.push({ lat: p.lat, lon: p.lon });
    if (this.points.length > MAX_POINTS) this.points = simplify(this.points, 3);
    return true;
  }
  get metres() { return pathLength(this.points); }
  stop() { this.active = false; return { name: this.name, points: this.points }; }
}
