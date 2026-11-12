// Spoken walking navigation: geocode a place, fetch a walking route, speak turns as the walker approaches them.
// Pure helpers are exported for tests; Navigator takes its network/GPS/speech dependencies as arguments.
import { roundDistance, durationPhrase } from './units.js';
import { CROSSING_TEXT } from './safetext.js';
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

// Instruction for one route step, e.g. "turn left". Street names are never spoken in directions: a blind walker cannot
// read a street sign, so "walk along Church Rd towards Southey Ave" tells them nothing they can act on (field test, 8 Nov).
export function instructionText(step) {
  if (step.text) return cleanStreetNames(step.text);
  const m = step.maneuver || {};
  if (m.type === 'arrive') return 'your destination'; // never "you have arrived": GPS can be 10 to 50 m out (Package G)
  if (m.type === 'depart') return 'walk straight';
  if (m.type === 'roundabout' || m.type === 'rotary') return `at the roundabout, take exit ${m.exit ?? 'ahead'}`;
  return MOD[m.modifier] || 'continue straight';
}

// Does this route step cross a road? Google puts it in the instruction ("Cross the road", "take the crosswalk"); OSRM
// steps can carry it in the street name (OSM footway=crossing ways are often named "... crossing") or in their
// intersection classes. OSRM does not pass on OSM highway=crossing nodes, so a crossing it does not name is missed: the
// route preview says "about" for that reason (Package G).
const CROSS_WORDS = /\b(?:cross(?:es|ing)?|crosswalk|zebra|pelican|puffin|toucan|subway|underpass)\b/i;
export function crossesRoad(step) {
  if (!step) return false;
  const m = step.maneuver || {};
  const text = [step.text, step.name, m.instruction, m.modifier && m.type === 'crossing' ? 'crossing' : ''].filter(Boolean).join(' ');
  if (CROSS_WORDS.test(text)) return true;
  return (step.intersections || []).some((x) => (x.classes || []).includes('crossing'));
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

// Street and place names are dropped from every spoken direction (see instructionText): "Turn left onto High Street"
// becomes "turn left", "Head north on Mill Lane toward Park Row" becomes "walk straight". "On the left/right" and
// "at the roundabout / end / top / bottom" are kept because they say where, not what a sign reads. A clause that is
// only a landmark ("pass by Tesco") is dropped.
const NAME_TAIL = /\s+(?:to stay on|onto|on|along|into|toward|towards|past|via|through|at)\s+(?!(?:the|your)\s+(?:left|right|roundabout|end|top|bottom)\b).*$/i;
export function cleanStreetNames(text) {
  const parts = String(text).split(/,\s*then\s+/i).map((c) => {
    let t = c.replace(/\s*\([^)]*\)/g, '').trim();
    if (/^pass(?:\s+by)?\b/i.test(t)) return '';
    t = t.replace(NAME_TAIL, '').trim();
    t = t.replace(/^walk(?:\s+along)?$/i, 'walk straight').replace(/^walk ahead$/i, 'walk straight').replace(/^continue$/i, 'continue straight');
    return t;
  }).filter(Boolean);
  return parts.join(', then ').replace(/\s{2,}/g, ' ').trim() || 'walk straight';
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
  steps.push({ distance: 0, name: '', text: 'your destination', maneuver: { type: 'arrive', location: [to.lon, to.lat] }, at: { lat: to.lat, lon: to.lon }, path: [] });
  return { distance: r.distanceMeters || steps.reduce((a, s) => a + (s.distance || 0), 0), duration: parseInt(r.duration, 10) || 0, steps };
}

// Package G: what the walker hears when Google cannot be used (quota, key refused, no connection) and OpenStreetMap takes
// over. Said at most once a minute: one request can fall back twice (place search, then route).
export const FALLBACK_TEXT = 'Google directions are not available, using backup maps.';
// Arrival: GPS can be 10 to 50 m out, so the app never claims the walker has arrived.
export const ARRIVE_TEXT = 'You should be near your destination. It may be a few steps either way.';
// Weak GPS: accuracy worse than weakMetres for weakMs.
export const WEAK_GPS_TEXT = 'GPS is weak here, so directions may be late.';

// "About 6 minutes." Short walks are said in steps (or the walker's units) instead of minutes. Only the time: the walker
// asked for directions. Crossings are not counted here (OSRM misses some, so a count could mislead); each crossing gets
// its own warning when the walker reaches that step (see _crossing).
export function routePreview(route) {
  const how = route.distance < 250 ? cap(roundMetres(route.distance)) : cap(minutesText(route.duration || route.distance / 1.2));
  return `${how}.`;
}

// Further than this and the place found is almost certainly not the one meant (8 Nov: "Lakeside" matched a shopping
// centre in Thurrock, "about 49 hours" away). About 2 hours' walk.
export const MAX_WALK_M = 10000;

// Google first (better place search, street names), OpenStreetMap as the fallback so navigation never goes silent.
// googleOnly (12 Nov, the owner has Google credits and wants Google only): no OpenStreetMap. A Google failure is tried once
// more after a short wait, then the walker hears the usual "could not search / could not get directions" message.
export function makeProviders({ googleKey, fetchFn = (...a) => fetch(...a), onFallback = () => {}, notify = null, now = () => Date.now(), googleOnly = false, retryMs = 500 }) {
  if (googleKey && googleOnly) {
    const twice = async (what, fn) => {
      try { return await fn(); } catch (e) {
        onFallback(`${what} (retry)`, e);
        await new Promise((r) => setTimeout(r, retryMs));
        return fn();
      }
    };
    return {
      async geocode(query, pos) { const g = await twice('place search', () => googleGeocode(query, pos, fetchFn, googleKey)); return g && { ...g, source: 'google' }; },
      async search(query, pos) { return (await twice('place search', () => googleGeocodeMany(query, pos, fetchFn, googleKey, 5))).map((d) => ({ ...d, source: 'google' })); },
      async route(from, to) { const r = await twice('route', () => googleRoute(from, to, fetchFn, googleKey)); return r && { ...r, source: 'google' }; },
    };
  }
  let notifiedAt = -Infinity;
  const fellBack = onFallback;
  onFallback = (what, e) => {
    fellBack(what, e);
    if (notify && now() - notifiedAt >= 60000) { notifiedAt = now(); notify(FALLBACK_TEXT); }
  };
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
  // A patchy signal reports an error every second or so. Say it once, then at most once a minute, and say when it is back.
  // A single error while good fixes keep arriving is not a lost signal (7 Nov: it was said twice on a walk where
  // directions kept working). Only say it once there has been no fix for lostAfterMs, and say when it comes back.
  locationLost() {
    const t = this.now();
    if (this.lastFixAt && t - this.lastFixAt < (this.lostAfterMs ?? 10000)) return;
    if (this.lostAt != null && t - this.lostAt < 60000) return;
    this.lostAt = t; this.lostSaid = true;
    this.say('I lost your location signal.', 'status');
  }

  constructor({ say, fetchFn = (...a) => fetch(...a), providers, getPosition, watch, unwatch, warnMetres = 40, nowMetres = 8, offRouteMetres = 40, reassureMs = 90000, reassureMetres = 80, weakMetres = 25, weakMs = 10000, now = () => Date.now(), trace = null }) {
    this.providers = providers || makeProviders({ fetchFn });
    Object.assign(this, { say, fetchFn, getPosition, watch, unwatch, warnMetres, nowMetres, offRouteMetres, reassureMs, reassureMetres, weakMetres, weakMs, now, trace });
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
    this.destination = dest; this.route = route; this.crossSaid = new Set(); this.idx = 1; this.warned = -1; this.nowSaid = -1; this.offCount = 0;
    this.lastReroute = Date.now(); this.lastSayAt = this.now(); this.lastFixAt = this.now(); this.silentSaid = false; this.weakSince = null; this.weakSaid = false; this.weakNow = false; this.nowPending = -1; this.active = true; this.oriented = false; this.startFix = null; this.large = !!dest.large; this.source = route.source;
    const first0 = route.steps[0];
    this.say(first && this.brief
      ? `${routePreview(route)} Starting. ${cap(instructionText(first0))} for ${roundMetres(first0.distance)}. I will tell you if you need to turn.`
      : first
      ? `Going to ${dest.name}. ${routePreview(route)}${this.large && first ? ' This is a large site, so I am heading for its middle. For a particular building, say its name.' : ''} ${route.steps.some((x) => /stairs|steps/i.test(x.text || '')) ? 'The route includes stairs. ' : ''}First, ${instructionText(first0)} for ${roundMetres(first0.distance)}.`
      : `New route. ${instructionText(first0)} for ${roundMetres(first0.distance)}.`, 'nav'); // 'nav', not 'status': the first turn prompt must not jump ahead of the route summary (live check 12 Nov)
    const c0 = this._crossing(first0); if (c0) this.say(c0.trim(), 'nav');
    this.watchId = this.watch((p) => this.onPosition(p), () => this.locationLost());
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
    if (this.lostSaid && !(p.accuracy != null && p.accuracy > 60)) { this.lostSaid = false; this.say('Location signal is back.', 'status'); }
    // Weak GPS (Package G): worse than weakMetres for weakMs is said once, and turn prompts wait for a second fix to agree.
    // Very poor fixes (over 60 m) are not used at all.
    const weak = p.accuracy != null && p.accuracy > (this.weakMetres ?? 25);
    if (weak) {
      if (this.weakSince == null) this.weakSince = t;
      if (!this.weakSaid && t - this.weakSince >= (this.weakMs ?? 10000)) { this.weakSaid = true; this.say(WEAK_GPS_TEXT, 'status'); }
    } else {
      this.weakSince = null;
      if (this.weakSaid) { this.weakSaid = false; this.say('Location signal is back.', 'status'); }
    }
    if (p.accuracy != null && p.accuracy > 60) return;
    this.weakNow = this.weakSaid;
    this.lastPos = p;
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
      this.say(ARRIVE_TEXT, 'nav');
      return this.cancel(true);
    }
    // Reached the point, or came within 25 m and is now moving away from it (fixes were too far apart to land inside 12 m).
    const passed = step.maneuver.type !== 'arrive' && this.minD <= 25 && d > this.minD + 8;
    // With weak GPS one fix can jump onto the turn: wait for a second fix that agrees before saying "now".
    const nowHere = d <= this.nowMetres || passed;
    if (nowHere && this.weakNow && this.nowPending !== this.idx) { this.nowPending = this.idx; return; }
    if (!nowHere && this.nowPending === this.idx) this.nowPending = -1;
    if (nowHere) {
      if (this.nowSaid !== this.idx && step.maneuver.type !== 'arrive') {
        this.nowSaid = this.idx;
        const next = this.route.steps[this.idx];
        let text = `${cap(instructionText(next))} now`;
        const said = [next];
        this.idx += 1;
        // Several turns within a few metres (OSM junction detail): say them together, not as separate alerts.
        while (this.route.steps[this.idx - 1].distance < 15 && this.route.steps[this.idx] && this.route.steps[this.idx].maneuver.type !== 'arrive') {
          text += `, then ${instructionText(this.route.steps[this.idx])}`;
          said.push(this.route.steps[this.idx]);
          this.idx += 1;
        }
        this.say(`${text}.${said.map((x) => this._crossing(x)).find(Boolean) || ''}`, 'nav');
      }
      return;
    }
    if (d <= this.warnMetres && this.warned !== this.idx) {
      this.warned = this.idx;
      this.say(step.maneuver.type === 'arrive' ? `Your destination is in ${roundMetres(d)}.` : `In ${roundMetres(d)}, ${instructionText(step)}.${this._crossing(step)}`, 'nav');
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

  // " Crossing ahead. I can't read the traffic signal..." the first time a crossing step is announced, else ''.
  _crossing(step) {
    if (!crossesRoad(step)) return '';
    this.crossSaid = this.crossSaid || new Set();
    if (this.crossSaid.has(step)) return '';
    this.crossSaid.add(step);
    return ` ${CROSSING_TEXT}`;
  }

  // Walk questions while navigating: "how far", "what's next", "am I on the right route".
  status(kind) {
    if (!this.active || !this.route) return 'You are not navigating at the moment. Say navigate to, and a place.';
    const p = this.lastPos;
    if (!p) return 'I do not have your location yet. Keep walking slowly and ask again.';
    const steps = this.route.steps, step = steps[this.idx];
    if (!step) return 'You are nearly there.';
    const toStep = haversine(p, step.at);
    if (kind === 'next') {
      return step.maneuver.type === 'arrive' ? `Next is your destination, in ${roundMetres(toStep)}.` : `In ${roundMetres(toStep)}, ${instructionText(step)}.`;
    }
    if (kind === 'onroute') {
      const legs = [...(steps[this.idx - 1]?.path || []), ...step.path];
      const off = legs.length ? distanceToPath(p, legs) : 0;
      return off > Math.max(this.offRouteMetres, (p.accuracy || 0) * 1.5)
        ? `You seem to be about ${roundMetres(off)} from the route. Keep listening; I will find a new way if you stay off it.`
        : 'Yes. You are on the route.';
    }
    let left = toStep; for (let k = this.idx; k < steps.length; k++) left += steps[k].distance || 0;
    const secs = this.route.distance > 0 ? (left / this.route.distance) * (this.route.duration || left / 1.2) : left / 1.2;
    return `Your destination is about ${roundMetres(left)} away, ${minutesText(secs)}.`;
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
