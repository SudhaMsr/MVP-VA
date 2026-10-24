// Spoken walking navigation: geocode a place, fetch a walking route, speak turns as the walker approaches them.
// Pure helpers are exported for tests; Navigator takes its network/GPS/speech dependencies as arguments.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];
export const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

// Distance in metres from point p to the polyline (array of {lat,lon}); flat-earth approximation is fine at street scale.
export function distanceToPath(p, path) {
  if (!path.length) return Infinity;
  if (path.length === 1) return haversine(p, path[0]);
  const k = Math.cos(rad(p.lat));
  const toXY = (q) => ({ x: rad(q.lon - p.lon) * R * k, y: rad(q.lat - p.lat) * R });
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = toXY(path[i]), b = toXY(path[i + 1]);
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return best;
}

export function roundMetres(m) {
  if (m < 15) return 'a few metres';
  if (m < 100) return `${Math.round(m / 10) * 10} metres`;
  return `${Math.round(m / 50) * 50} metres`;
}

const MOD = {
  left: 'turn left', right: 'turn right', 'slight left': 'bear left', 'slight right': 'bear right',
  'sharp left': 'turn sharp left', 'sharp right': 'turn sharp right', straight: 'continue straight', uturn: 'turn around',
};

// Instruction for one OSRM step, e.g. "turn left onto High Street".
export function instructionText(step) {
  const m = step.maneuver || {};
  const name = step.name ? ` onto ${step.name}` : '';
  if (m.type === 'arrive') return 'you have arrived';
  if (m.type === 'depart') return `walk ${compass(m.bearing_after ?? 0)}${step.name ? ` on ${step.name}` : ''}`;
  if (m.type === 'roundabout' || m.type === 'rotary') return `at the roundabout, take exit ${m.exit ?? 'ahead'}${name}`;
  const verb = MOD[m.modifier] || 'continue';
  return verb === 'continue straight' ? `continue straight${step.name ? ` on ${step.name}` : ''}` : `${verb}${name}`;
}

export function minutesText(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  return mins === 1 ? 'about 1 minute' : `about ${mins} minutes`;
}

export async function geocode(query, pos, fetchFn) {
  const dv = 0.15; // bias to roughly 15 km around the walker
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=' + encodeURIComponent(query) +
    (pos ? `&viewbox=${pos.lon - dv},${pos.lat + dv},${pos.lon + dv},${pos.lat - dv}` : '');
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('search');
  const j = await res.json();
  if (!j.length) return null;
  // Big places (a university, a park) come back as one far-away centre point: take the match nearest the walker.
  const best = pos ? j.reduce((a, b) => (haversine(pos, { lat: +b.lat, lon: +b.lon }) < haversine(pos, { lat: +a.lat, lon: +a.lon }) ? b : a)) : j[0];
  const bb = (best.boundingbox || []).map(Number); // [south, north, west, east]
  const large = bb.length === 4 && haversine({ lat: bb[0], lon: bb[2] }, { lat: bb[1], lon: bb[3] }) > 1500;
  return { large, lat: +best.lat, lon: +best.lon, name: (best.display_name || query).split(',').slice(0, 2).join(',') };
}

export async function fetchRoute(from, to, fetchFn) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}` +
    '?steps=true&geometries=geojson&overview=false';
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('route');
  const j = await res.json();
  const r = j.routes && j.routes[0];
  if (!r) return null;
  const steps = r.legs[0].steps.map((s) => ({
    ...s, path: (s.geometry?.coordinates || []).map(([lon, lat]) => ({ lat, lon })),
    at: { lat: s.maneuver.location[1], lon: s.maneuver.location[0] },
  }));
  return { distance: r.distance, duration: r.duration, steps };
}

export class Navigator {
  constructor({ say, fetchFn = (...a) => fetch(...a), getPosition, watch, unwatch, warnMetres = 40, nowMetres = 12, offRouteMetres = 40 }) {
    Object.assign(this, { say, fetchFn, getPosition, watch, unwatch, warnMetres, nowMetres, offRouteMetres });
    this.active = false;
    this.destination = null;
  }

  async start(query) {
    this.cancel(true);
    this.say(`Looking for ${query}.`, 'status');
    let pos;
    try { pos = await this.getPosition(); } catch { this.say('I cannot find your location. Check location permission and try again.', 'status'); return false; }
    let dest;
    try { dest = await geocode(query, pos, this.fetchFn); } catch { this.say('I could not search for places. Check your internet connection.', 'status'); return false; }
    if (!dest) { this.say(`I could not find ${query}. Try a nearby street or a well known place.`, 'status'); return false; }
    return this._route(pos, dest, true);
  }

  async _route(pos, dest, first) {
    let route;
    try { route = await fetchRoute(pos, dest, this.fetchFn); } catch { this.say('I could not get walking directions. Check your internet connection.', 'status'); return false; }
    if (!route) { this.say('I could not find a walking route there.', 'status'); return false; }
    this.destination = dest; this.route = route; this.idx = 1; this.warned = -1; this.nowSaid = -1; this.offCount = 0;
    this.lastReroute = Date.now(); this.active = true; this.large = !!dest.large;
    const first0 = route.steps[0];
    this.say(first
      ? `Going to ${dest.name}. ${roundMetres(route.distance)}, ${minutesText(route.duration)}.${this.large && first ? ' This is a large site, so I am heading for its middle. For a particular building, say its name.' : ''} Say cancel to stop. First, ${instructionText(first0)} for ${roundMetres(first0.distance)}.`
      : `New route. ${instructionText(first0)} for ${roundMetres(first0.distance)}.`, 'status');
    this.watchId = this.watch((p) => this.onPosition(p), () => this.say('I lost your location signal.', 'status'));
    return true;
  }

  onPosition(p) {
    if (!this.active || (p.accuracy != null && p.accuracy > 60)) return; // ignore poor fixes
    const step = this.route.steps[this.idx];
    if (!step) return;
    const d = haversine(p, step.at);
    if (step.maneuver.type === 'arrive' && d <= this.nowMetres + 8) {
      this.say(`You have arrived at ${this.destination.name}.`, 'status');
      return this.cancel(true);
    }
    if (d <= this.nowMetres) {
      if (this.nowSaid !== this.idx && step.maneuver.type !== 'arrive') {
        this.nowSaid = this.idx;
        const next = this.route.steps[this.idx];
        let text = `${cap(instructionText(next))} now`;
        this.idx += 1;
        // Several turns within a few metres (OSM junction detail): say them together, not as separate alerts.
        while (this.route.steps[this.idx - 1].distance < 15 && this.route.steps[this.idx] && this.route.steps[this.idx].maneuver.type !== 'arrive') {
          text += `, then ${instructionText(this.route.steps[this.idx])}`;
          this.idx += 1;
        }
        this.say(`${text}.`, 'status');
      }
      return;
    }
    if (d <= this.warnMetres && this.warned !== this.idx) {
      this.warned = this.idx;
      this.say(`In ${roundMetres(d)}, ${instructionText(step)}.`, 'status');
      return;
    }
    // off-route check against the current and previous leg
    const legs = [...(this.route.steps[this.idx - 1]?.path || []), ...step.path];
    if (legs.length && distanceToPath(p, legs) > this.offRouteMetres) {
      this.offCount += 1;
      if (this.offCount >= 2 && Date.now() - this.lastReroute > 15000) {
        this.lastReroute = Date.now(); this.offCount = 0;
        this.say('Off route. Finding a new way.', 'status');
        this._route(p, this.destination, false);
      }
    } else this.offCount = 0;
  }

  cancel(silent = false) {
    const was = this.active;
    this.active = false;
    if (this.watchId != null && this.unwatch) this.unwatch(this.watchId);
    this.watchId = null;
    if (was && !silent) this.say('Navigation cancelled.', 'status');
    return was;
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
