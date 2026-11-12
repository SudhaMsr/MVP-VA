// "Where am I?" and saved places ("save this place as home", "take me home").
// Street lookup: Google (Geocoding for the street, Places for the nearest named place) when there is a key (12 Nov: the
// owner wants Google only); OpenStreetMap's Nominatim only without a key. Saved places stay in the phone's own storage.
// ---- where am I ----
export async function reverseLookup(pos, fetchFn = (...a) => fetch(...a), key = '') {
  if (key) return googleReverse(pos, fetchFn, key);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${pos.lat}&lon=${pos.lon}`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('reverse ' + res.status);
  return res.json();
}

// Google address parts in the shape describePlace reads (Nominatim's), so the wording stays the same.
export function fromGoogleComponents(comps = [], name = '') {
  const get = (...types) => { for (const t of types) { const c = comps.find((x) => (x.types || []).includes(t)); if (c) return c.long_name || c.longText || ''; } return ''; };
  return { name, address: { house_number: get('street_number'), road: get('route'), suburb: get('neighborhood', 'sublocality_level_1', 'sublocality'), city: get('postal_town', 'locality') } };
}

// Google's Geocoding web service refuses keys locked to a website (checked 12 Nov: "API keys with referer restrictions
// cannot be used with this API"), and the key must stay locked. So the street comes from Places: the street most of the
// nearest places (within 40 m) are on, and the nearest named place that is not a holiday flat. No house number: it would
// be a business's number, not the walker's.
const SKIP_TYPES = /lodging|apartment|hotel|guest_house|bed_and_breakfast|hostel|real_estate|corporate_office|consultant/;
export async function googleReverse(pos, fetchFn, key) {
  const r = await fetchFn('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.addressComponents,places.primaryType' },
    body: JSON.stringify({ maxResultCount: 5, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: pos.lat, longitude: pos.lon }, radius: 40 } } }),
  });
  if (!r.ok) throw new Error('places ' + r.status);
  const places = (await r.json()).places || [];
  if (!places.length) return { address: {} };
  const parts = places.map((p) => fromGoogleComponents(p.addressComponents || []).address);
  const most = (k) => {
    const n = new Map();
    for (const a of parts) if (a[k]) n.set(a[k], (n.get(a[k]) || 0) + 1);
    return [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '';
  };
  const named = places.find((p) => p.displayName && p.displayName.text && !SKIP_TYPES.test(p.primaryType || ''));
  return { name: named ? named.displayName.text : '', address: { road: most('road'), suburb: most('suburb'), city: most('city') } };
}

const first = (...v) => v.find((x) => x && String(x).trim());

// Plain-language location from a Nominatim reverse result.
export function describePlace(j, accuracy = null) {
  const a = (j && j.address) || {};
  const road = first(a.road, a.pedestrian, a.footway, a.path, a.cycleway, a.square);
  const area = first(a.suburb, a.neighbourhood, a.quarter, a.city_district, a.village, a.town, a.city);
  const city = first(a.city, a.town, a.village);
  const near = first(j && j.name && j.name !== road ? j.name : null, a.amenity, a.shop, a.tourism);
  let text;
  if (road) {
    const num = a.house_number ? `near number ${a.house_number}, ` : '';
    text = `You are ${num}on ${road}`;
    const where = first(area, city);
    if (where) text += `, in ${where}`;
    if (city && area && city !== area) text += `, ${city}`;
    text += '.';
    if (near) text += ` Close by is ${near}.`;
  } else if (first(area, city)) {
    text = `You are in ${[area, city].filter((x, i, arr) => x && arr.indexOf(x) === i).join(', ')}.`;
  } else {
    return 'I could not tell which street you are on.';
  }
  // GPS can be 10 to 50 metres out (users said they distrust it), so say when it is worse than usual.
  if (accuracy != null && accuracy > 30) text += ' My location signal is weak, so this may be a little off.';
  return text;
}

// ---- saved places ----
// "my home", "the office", "Home." -> "home" / "office"
export function normaliseName(raw) {
  return String(raw || '').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\b(my|the|a|please)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export class PlaceStore {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null), key = 'va.places') {
    this.storage = storage; this.key = key; this.mem = {};
  }
  _load() {
    try { const raw = this.storage && this.storage.getItem(this.key); if (raw) return { ...this.mem, ...JSON.parse(raw) }; } catch (_) { /* storage can be unavailable */ }
    return { ...this.mem };
  }
  _save(all) {
    this.mem = all;
    try { if (this.storage) { this.storage.setItem(this.key, JSON.stringify(all)); return true; } } catch (_) { /* kept in memory for this visit */ }
    return false; // not stored on the phone: only remembered until the page is closed
  }
  save(rawName, pos, extra = {}) {
    const name = normaliseName(rawName);
    if (!name) return null;
    const all = this._load();
    const replaced = !!all[name];
    all[name] = { name, lat: pos.lat, lon: pos.lon, ...extra, savedAt: Date.now() };
    const persisted = this._save(all);
    return { name, replaced, persisted };
  }
  get(rawName) { return this._load()[normaliseName(rawName)] || null; }
  list() { return Object.values(this._load()).map((p) => p.name).sort(); }
  remove(rawName) { const all = this._load(); const n = normaliseName(rawName); const had = !!all[n]; delete all[n]; this._save(all); return had; }
}
