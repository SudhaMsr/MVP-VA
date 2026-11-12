// "What is near me?" (12 Nov): shops and places around the walker from Google Places, nearest first, with how far and,
// when the walker has been moving, which side (ahead, left, right, behind). Answers "is it a coffee shop or a post office?".
// Map positions are a few metres out, so the answer says so; nothing here is a safety judgement.
import { haversine, bearing } from './nav.js';
import { roundDistance } from './units.js';

const FIELDS = 'places.displayName,places.location,places.primaryTypeDisplayName,places.primaryType,places.businessStatus';
// Not useful to someone asking what is around them (live check 12 Nov: holiday flats and offices filled the answer).
// Only for "what is near me"; asking for a kind of place ("is there a hotel nearby") keeps everything.
export const SKIP_NEARBY = /lodging|apartment|hotel|guest_house|bed_and_breakfast|hostel|student_housing|real_estate|corporate_office|consultant|accounting|insurance_agency|lawyer/;

// query: null for everything nearby, or what the walker asked for ("cafe", "post office").
export async function searchNearby(pos, { key, fetchFn = (...a) => fetch(...a), query = null, radius = 120, max = 10 } = {}) {
  const center = { latitude: pos.lat, longitude: pos.lon };
  const [url, body] = query
    ? ['https://places.googleapis.com/v1/places:searchText', { textQuery: query, maxResultCount: Math.min(max, 5), rankPreference: 'DISTANCE', locationBias: { circle: { center, radius: 800 } } }]
    : ['https://places.googleapis.com/v1/places:searchNearby', { maxResultCount: max, rankPreference: 'DISTANCE', locationRestriction: { circle: { center, radius } } }];
  const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('google nearby ' + res.status);
  const j = await res.json();
  return (j.places || [])
    .filter((p) => p.location && p.businessStatus !== 'CLOSED_PERMANENTLY' && (query || !SKIP_NEARBY.test(p.primaryType || '')))
    .map((p) => ({ name: (p.displayName && p.displayName.text) || '', type: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '', lat: p.location.latitude, lon: p.location.longitude }))
    .filter((p) => p.name);
}

// Which way the walker is going, from their last few location fixes (no compass words: it is only used for left/right).
export class WalkHeading {
  constructor({ minMove = 8, maxAgeMs = 30000, maxAccuracy = 30 } = {}) { Object.assign(this, { minMove, maxAgeMs, maxAccuracy }); this.fixes = []; }
  // fix: { lat, lon, accuracy, t, heading?, speed? } (heading and speed straight from the GPS, when it gives them)
  add(fix) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    const t = fix.t ?? Date.now();
    this.fixes.push({ ...fix, t });
    this.fixes = this.fixes.filter((f) => t - f.t <= this.maxAgeMs).slice(-40);
  }
  // degrees, or null when the walker has not moved far enough (or the fixes are too rough) to tell
  get(now = Date.now()) {
    const fresh = this.fixes.filter((f) => now - f.t <= this.maxAgeMs && (f.accuracy == null || f.accuracy <= this.maxAccuracy));
    if (!fresh.length) return null;
    const last = fresh[fresh.length - 1];
    if (now - last.t > 10000) return null;
    if (Number.isFinite(last.heading) && Number.isFinite(last.speed) && last.speed > 0.6) return last.heading;
    for (const f of fresh) if (haversine(f, last) >= this.minMove) return bearing(f, last);
    return null;
  }
}

// ahead / on your right / behind you / on your left, relative to the way the walker is going; null without a heading.
export function sideOf(pos, place, heading) {
  if (heading == null || !Number.isFinite(heading)) return null;
  const d = ((bearing(pos, place) - heading + 540) % 360) - 180; // + = to the right
  if (Math.abs(d) <= 40) return 'ahead';
  if (Math.abs(d) >= 140) return 'behind you';
  return d > 0 ? 'on your right' : 'on your left';
}

const lower = (s) => String(s || '').toLowerCase();

export function nearbySpeech(places, pos, { heading = null, query = null, max = 4, maxM = query ? 800 : 150 } = {}) {
  const near = places.map((p) => ({ ...p, d: haversine(pos, p) })).filter((p) => p.d <= maxM).sort((a, b) => a.d - b.d).slice(0, max);
  if (!near.length) return query ? `I could not find ${/^(a|an|the)\s/i.test(query) ? query : `a ${query}`} near you.` : 'I could not find any shops or places close to you.';
  const items = near.map((p) => {
    const type = p.type && !lower(p.name).includes(lower(p.type)) ? `, ${lower(p.type)}` : '';
    const side = sideOf(pos, p, heading);
    return `${p.name}${type}, ${roundDistance(p.d)}${side ? ` ${side}` : ''}`;
  });
  let text = `${query ? 'Nearest' : 'Near you'}: ${items.join('. ')}.`;
  text += heading == null ? ' Walk a few steps and ask again to hear which side they are on.' : ' Map positions can be a few steps out.';
  if (query) text += ` Say navigate to ${near[0].name}, to go there.`;
  return text;
}
