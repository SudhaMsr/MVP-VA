// Spoken walking navigation: geocode a place, fetch a walking route, speak turns as the walker approaches them.
// Pure helpers are exported for tests; Navigator takes its network/GPS/speech dependencies as arguments.
import { roundDistance, durationPhrase } from './units.js';
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

// Spoken route distance. Metres by default; steps when the walker has asked for them (see units.js).
// The point `ahead` metres further along a route line, from the spot on the line nearest to p. Used to judge the walker's
// heading against the way the route really goes: a leg can bend, so a straight line to its end would give false alarms.
export function pointAhead(path, p, ahead = 30) {
  if (!path || !path.length) return null;
  if (path.length === 1) return path[0];
  const k = Math.cos(rad(p.lat));
  const pts = path.map((q) => ({ x: rad(q.lon - p.lon) * R * k, y: rad(q.lat - p.lat) * R }));
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best.d) best = { d, i, t };
  }
  let cur = { x: pts[best.i].x + (pts[best.i + 1].x - pts[best.i].x) * best.t, y: pts[best.i].y + (pts[best.i + 1].y - pts[best.i].y) * best.t };
  let remaining = ahead;
  const back = (q) => ({ lat: p.lat + (q.y / R) * (180 / Math.PI), lon: p.lon + (q.x / (R * k)) * (180 / Math.PI) });
  for (let i = best.i; i < pts.length - 1; i++) {
    const b = pts[i + 1], seg = Math.hypot(b.x - cur.x, b.y - cur.y);
    if (seg >= remaining) { const f = seg === 0 ? 0 : remaining / seg; return back({ x: cur.x + (b.x - cur.x) * f, y: cur.y + (b.y - cur.y) * f }); }
    remaining -= seg; cur = b;
  }
  return path[path.length - 1];
}

export function roundMetres(m) { return roundDistance(m); }

const MOD = {
  left: 'turn left', right: 'turn right', 'slight left': 'keep left', 'slight right': 'keep right',
  'sharp left': 'turn sharp left', 'sharp right': 'turn sharp right', straight: 'continue straight', uturn: 'turn around',
};

// Instruction for one OSRM step, e.g. "turn left onto High Street".
export function instructionText(step) {
  if (step.text) return step.text;
  const m = step.maneuver || {};
  const name = step.name ? ` onto ${step.name}` : '';
  if (m.type === 'arrive') return 'you have arrived';
  if (m.type === 'depart') return step.name ? `walk along ${step.name}` : 'walk ahead';
  if (m.type === 'roundabout' || m.type === 'rotary') return `at the roundabout, take exit ${m.exit ?? 'ahead'}${name}`;
  const verb = MOD[m.modifier] || 'continue';
  return verb === 'continue straight' ? `continue straight${step.name ? ` on ${step.name}` : ''}` : `${verb}${name}`;
}

// Journey time, rounded so it is easy to take in (see units.js).
export function minutesText(seconds) { return durationPhrase(seconds); }

export async function geocodeMany(query, pos, fetchFn, max = 3) {
  const dv = 0.15; // bias to roughly 15 km around the walker
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=' + encodeURIComponent(query) +
    (pos ? `&viewbox=${pos.lon - dv},${pos.lat + dv},${pos.lon + dv},${pos.lat - dv}` : '');
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('search');
  const j = await res.json();
  return j.slice(0, max).map(toDest);
}

export async function geocode(query, pos, fetchFn) {
  return (await geocodeMany(query, pos, fetchFn, 1))[0] || null;
}

function toDest(best) {
  const bb = (best.boundingbox || []).map(Number); // [south, north, west, east]
  const large = bb.length === 4 && haversine({ lat: bb[0], lon: bb[2] }, { lat: bb[1], lon: bb[3] }) > 1500;
  return { large, address: best.display_name || '', lat: +best.lat, lon: +best.lon, name: (best.display_name || 'that place').split(',').slice(0, 2).join(',') };
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

// Blind walkers cannot use compass points or vague words ("bear", "slightly"): see the research notes in README.
export function plainWords(text) {
  let t = text.trim();
  t = t.replace(/^head\b/i, 'walk');
  t = t.replace(/\b(?:(?:north|south)[- ]?)?(?:east|west)\b|\b(?:north|south)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^walk\s+(on|along)\b/i, 'walk along').replace(/^walk\s*$/i, 'walk ahead');
  t = t.replace(/\b(?:turn\s+)?slight(?:ly)?\s+(left|right)\b/gi, 'keep $1').replace(/\bbear\s+(left|right)\b/gi, 'keep $1');
  return t;
}

// Google sometimes names stops, ferries and stations ("Temple Meads - Castle Park/Temple Meads Ferry"). Spoken, that is
// confusing, so any street name containing " - " or "/" is dropped and the instruction becomes plain left/right/straight.
const ODD_NAME = /\s(?:onto|on|along|into)\s+([^,.]*?(?:\s[-\u2013\u2014]\s|\/)[^,.]*?)(?=,|\.|$|\sthen\b|\stoward|\stowards)/i;
export function cleanStreetNames(text) {
  let t = text;
  for (let i = 0; i < 3 && ODD_NAME.test(t); i++) t = t.replace(ODD_NAME, '');
  t = t.replace(/^walk along\s*$/i, 'walk straight').replace(/^walk\s*$/i, 'walk straight')
    .replace(/^walk along(?=,|$)/i, 'walk straight').replace(/^continue(?=,|$)/i, 'continue straight');
  return t.replace(/\s{2,}/g, ' ').trim();
}

// ---- Google (Places API New + Routes API). Key is restricted to this site's address in Google Cloud. ----
const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

export async function googleGeocodeMany(query, pos, fetchFn, key, max = 3) {
  const body = { textQuery: query, maxResultCount: max };
  if (pos) body.locationBias = { circle: { center: { latitude: pos.lat, longitude: pos.lon }, radius: 15000 } };
  const res = await fetchFn('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.navigationPoints' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('google places ' + res.status);
  const j = await res.json();
  return (j.places || []).map((p) => {
    const street = (p.formattedAddress || '').split(',')[0];
    const parts = [p.displayName?.text, street].filter(Boolean);
    const name = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(', '); // "25 Lakeside" not "25 Lakeside, 25 Lakeside"
    // Big places (a university, a hospital, a station) list their entrances. Aim for the one nearest the walker, not the middle of the site.
    let { latitude: lat, longitude: lon } = p.location;
    const gates = (p.navigationPoints || []).map((n) => n.location).filter(Boolean);
    if (pos && gates.length) {
      const near = gates.map((g) => ({ g, d: haversine(pos, { lat: g.latitude, lon: g.longitude }) })).sort((x, y) => x.d - y.d)[0].g;
      lat = near.latitude; lon = near.longitude;
    }
    return { large: false, entrance: gates.length > 0, address: p.formattedAddress || '', lat, lon, name };
  });
}

export async function googleGeocode(query, pos, fetchFn, key) {
  return (await googleGeocodeMany(query, pos, fetchFn, key, 1))[0] || null;
}

export async function googleRoute(from, to, fetchFn, key) {
  const res = await fetchFn('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.startLocation,routes.legs.steps.polyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
      travelMode: 'WALK', polylineEncoding: 'GEO_JSON_LINESTRING', languageCode: 'en-GB', units: 'METRIC',
    }),
  });
  if (!res.ok) throw new Error('google routes ' + res.status);
  const j = await res.json();
  const r = j.routes && j.routes[0];
  if (!r) return null;
  const raw = r.legs[0].steps;
  const steps = raw.map((s, i) => {
    const ll = s.startLocation.latLng;
    const text = ((s.navigationInstruction && s.navigationInstruction.instructions) || '')
      .split('\n').map((t) => lowerFirst(cleanStreetNames(plainWords(t)))).filter(Boolean).join(', then ');
    return {
      distance: s.distanceMeters || 0, name: '', text: text || (i === 0 ? 'walk ahead' : 'continue'),
      maneuver: { type: i === 0 ? 'depart' : 'turn', location: [ll.longitude, ll.latitude] },
      at: { lat: ll.latitude, lon: ll.longitude },
      path: (s.polyline?.geoJsonLinestring?.coordinates || []).map(([lon, lat]) => ({ lat, lon })),
    };
  });
  steps.push({ distance: 0, name: '', text: 'you have arrived', maneuver: { type: 'arrive', location: [to.lon, to.lat] }, at: { lat: to.lat, lon: to.lon }, path: [] });
  return { distance: r.distanceMeters || steps.reduce((a, s) => a + (s.distance || 0), 0), duration: parseInt(r.duration, 10) || 0, steps };
}

// Google first (better place search, street names), OpenStreetMap as the fallback so navigation never goes silent.
export function makeProviders({ googleKey, fetchFn = (...a) => fetch(...a), onFallback = () => {} }) {
  return {
    async geocode(query, pos) {
      if (googleKey) {
        try { const g = await googleGeocode(query, pos, fetchFn, googleKey); if (g) return { ...g, source: 'google' }; } catch (e) { onFallback('place search', e); }
      }
      const g = await geocode(query, pos, fetchFn);
      return g && { ...g, source: 'osm' };
    },
    async search(query, pos) {
      if (googleKey) {
        try { const g = await googleGeocodeMany(query, pos, fetchFn, googleKey, 5); if (g.length) return g.map((d) => ({ ...d, source: 'google' })); } catch (e) { onFallback('place search', e); }
      }
      return (await geocodeMany(query, pos, fetchFn, 5)).map((d) => ({ ...d, source: 'osm' }));
    },
    async route(from, to) {
      if (googleKey) {
        try { const r = await googleRoute(from, to, fetchFn, googleKey); if (r) return { ...r, source: 'google' }; } catch (e) { onFallback('route', e); }
      }
      const r = await fetchRoute(from, to, fetchFn);
      return r && { ...r, source: 'osm' };
    },
  };
}

// What to say when the location cannot be had. The reason matters: "check permission" is wrong when the permission is fine.
export function locationMessage(err, prefix = 'I cannot find your location.') {
  const code = err && err.code;
  if (code === 1) return `${prefix} Location is blocked for this page. Tap the lock icon by the address, allow location, then try again.`;
  if (code === 2) return `${prefix} The device could not work out where it is. Check that location services are on for the whole device, and for this browser, then try again. Indoors or on a laptop it can help to wait a little.`;
  if (code === 3) return `${prefix} It took too long. Try again, near a window or outside if you can.`;
  return `${prefix} Please try again.`;
}

export class Navigator {
  constructor({ say, fetchFn = (...a) => fetch(...a), providers, getPosition, watch, unwatch, warnMetres = 40, nowMetres = 8, offRouteMetres = 40, reassureMs = 90000, reassureMetres = 80, now = () => Date.now(), trace = null }) {
    this.providers = providers || makeProviders({ fetchFn });
    Object.assign(this, { say, fetchFn, getPosition, watch, unwatch, warnMetres, nowMetres, offRouteMetres, reassureMs, reassureMetres, now, trace });
    this.say = (t, k) => { this.lastSayAt = this.now(); say(t, k); }; // remember when we last spoke, for reassurance
    this.active = false;
    this.destination = null;
  }

  async start(query) {
    this.cancel(true);
    this.say(`Looking for ${query}.`, 'status');
    let pos;
    try { pos = await this.getPosition(); } catch (e) { this.say(locationMessage(e), 'status'); return false; }
    let dest;
    try { dest = await this.providers.geocode(query, pos); } catch { this.say('I could not search for places. Check your internet connection.', 'status'); return false; }
    if (!dest) { this.say(`I could not find ${query}. Try a nearby street or a well known place.`, 'status'); return false; }
    return this._route(pos, dest, true);
  }

  // Find one place or address without needing the walker's location (used to save a home address). Null if nothing found.
  async lookup(query, pos = null) { return this.providers.geocode(query, pos); }

  // Step 1 of a spoken request: look up places near the walker (up to 3).
  async find(query) {
    this.cancel(true);
    let pos;
    try { pos = await this.getPosition(); } catch (e) { this.say(locationMessage(e), 'status'); return null; }
    let results;
    try { results = await this.providers.search(query, pos); } catch { this.say('I could not search for places. Check your internet connection.', 'status'); return null; }
    if (!results.length) { this.say(`I could not find ${query}. Try a nearby street or a well known place.`, 'status'); return null; }
    return { pos, results };
  }

  // Step 2: get the route without starting, so the walker can be told the distance and agree first.
  async plan(pos, dest) {
    try { return await this.providers.route(pos, dest); } catch { this.say('I could not get walking directions. Check your internet connection.', 'status'); return null; }
  }

  begin(pos, dest, route, first = true, brief = false) { this.brief = brief; return this._begin(pos, dest, route, first); }

  async _route(pos, dest, first) {
    let route;
    try { route = await this.providers.route(pos, dest); } catch { this.say('I could not get walking directions. Check your internet connection.', 'status'); return false; }
    if (!route) { this.say('I could not find a walking route there.', 'status'); return false; }
    return this._begin(pos, dest, route, first);
  }

  _begin(pos, dest, route, first) {
    this.destination = dest; this.route = route; this.idx = 1; this.warned = -1; this.nowSaid = -1; this.offCount = 0;
    this.lastReroute = Date.now(); this.lastSayAt = this.now(); this.lastFixAt = this.now(); this.silentSaid = false; this.weakSince = 0; this.weakSaid = false; this.active = true; this.oriented = false; this.startFix = null; this.large = !!dest.large; this.source = route.source;
    const first0 = route.steps[0];
    this.say(first && this.brief
      ? `Starting. ${cap(instructionText(first0))} for ${roundMetres(first0.distance)}. I will tell you if you need to turn.`
      : first
      ? `Going to ${dest.name}. ${roundMetres(route.distance)}, ${minutesText(route.duration)}.${this.large && first ? ' This is a large site, so I am heading for its middle. For a particular building, say its name.' : ''} ${route.steps.some((x) => /stairs|steps/i.test(x.text || '')) ? 'The route includes stairs. ' : ''}Say cancel to stop. First, ${instructionText(first0)} for ${roundMetres(first0.distance)}. Start walking and I will tell you if you need to turn.`
      : `New route. ${instructionText(first0)} for ${roundMetres(first0.distance)}.`, 'status');
    this.watchId = this.watch((p) => this.onPosition(p), () => this.say('I lost your location signal.', 'status'));
    return true;
  }

  // After ~10 m of walking, compare the walker's real heading with the route and say left/right/turn around.
  checkOrientation(p) {
    if (this.oriented) return;
    if (!this.startFix) { this.startFix = { lat: p.lat, lon: p.lon }; return; }
    if (haversine(this.startFix, p) < 10) return;
    this.oriented = true;
    const ahead = this.route.steps.slice(0, 3).flatMap((st) => st.path || []);
    const target = pointAhead(ahead, p, 30) || this.route.steps[1]?.at;
    if (!target) return;
    const diff = ((bearing(p, target) - bearing(this.startFix, p) + 540) % 360) - 180; // + = route is to the right
    const a = Math.abs(diff);
    if (a < 45) this.say('You are going the right way.', 'nav');
    else if (a > 135) this.say('Wrong way. Turn around.', 'nav');
    else this.say(`The route is to your ${diff > 0 ? 'right' : 'left'}. Turn ${diff > 0 ? 'right' : 'left'} when you can.`, 'nav');
  }

  onPosition(p) {
    if (!this.active) return;
    const t = this.now();
    this.lastFixAt = t; this.silentSaid = false;
    if (p.accuracy != null && p.accuracy > 60) { // ignore poor fixes, but never silently: tell the walker if it goes on
      if (!this.weakSince) this.weakSince = t;
      if (!this.weakSaid && t - this.weakSince > 15000) { this.weakSaid = true; this.say('My location signal is weak. I may be late with turns, so go carefully.', 'status'); }
      return;
    }
    this.weakSince = 0;
    if (this.weakSaid) { this.weakSaid = false; this.say('Location signal is back.', 'status'); }
    this.checkOrientation(p);
    // GPS can jump (or the walker can be past a turn we never announced): if a later turn point is right here, go to it.
    const here = this.route.steps[this.idx];
    if (here && haversine(p, here.at) > this.nowMetres) {
      for (let j = this.idx + 1; j <= Math.min(this.idx + 3, this.route.steps.length - 1); j++) {
        if (haversine(p, this.route.steps[j].at) <= this.nowMetres) { this.idx = j; break; }
      }
    }
    const step = this.route.steps[this.idx];
    if (!step) return;
    const d = haversine(p, step.at);
    if (this.minIdx !== this.idx) { this.minIdx = this.idx; this.minD = Infinity; }
    this.minD = Math.min(this.minD, d);
    if (this.trace) this.trace({ lat: p.lat, lon: p.lon, accuracy: p.accuracy ?? null, step: this.idx, toTurn: Math.round(d) });
    if (step.maneuver.type === 'arrive' && d <= this.nowMetres + 8) {
      this.say(`You have arrived at ${this.destination.name}.`, 'nav');
      return this.cancel(true);
    }
    // Reached the point, or came within 25 m and is now moving away from it (fixes were too far apart to land inside 12 m).
    const passed = step.maneuver.type !== 'arrive' && this.minD <= 25 && d > this.minD + 8;
    if (d <= this.nowMetres || passed) {
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
        this.say(`${text}.`, 'nav');
      }
      return;
    }
    if (d <= this.warnMetres && this.warned !== this.idx) {
      this.warned = this.idx;
      this.say(step.maneuver.type === 'arrive' ? `Your destination is in ${roundMetres(d)}.` : `In ${roundMetres(d)}, ${instructionText(step)}.`, 'nav');
      return;
    }
    // off-route check against the current and previous leg
    const legs = [...(this.route.steps[this.idx - 1]?.path || []), ...step.path];
    // GPS can be 10 to 50 m out: never call it off route when the fix itself is that imprecise.
    if (legs.length && distanceToPath(p, legs) > Math.max(this.offRouteMetres, (p.accuracy || 0) * 1.5)) {
      this.offCount += 1;
      if (this.offCount >= 2 && Date.now() - this.lastReroute > 15000) {
        this.lastReroute = Date.now(); this.offCount = 0;
        if (this.route.source === 'recorded') { this.say('You are off your recorded route. Walk back toward the path you took.', 'nav'); return; }
        this.say('Off route. Finding a new way.', 'nav');
        this._route(p, this.destination, false);
      }
    } else {
      this.offCount = 0;
      // A long quiet stretch: reassure the walker that they are still on the route (and roughly how far to the next turn).
      if (d > Math.max(this.warnMetres + 10, this.reassureMetres) && this.now() - this.lastSayAt > this.reassureMs) {
        const what = step.maneuver.type === 'arrive' ? 'Your destination is' : 'The next turn is';
        this.say(`Keep going. You are on the route. ${what} about ${roundMetres(d)} away.`, 'status');
      }
    }
  }

  // Called about once a second by the app: the phone can simply stop sending locations without raising an error.
  tick() {
    if (!this.active || !this.lastFixAt) return;
    if (!this.silentSaid && this.now() - this.lastFixAt > 30000) {
      this.silentSaid = true;
      this.say('I have not had a location update for a while. Please go carefully.', 'status');
    }
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
