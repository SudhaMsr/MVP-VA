// Package G: navigation you can rely on. Route preview with crossings, weak GPS, careful arrival, spoken fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits } from '../docs/js/units.js';
import { Navigator, makeProviders, routePreview, FALLBACK_TEXT, ARRIVE_TEXT, WEAK_GPS_TEXT } from '../docs/js/nav.js';
import { isSafeText } from '../docs/js/safetext.js';

const step = (type, lat, lon, text, distance, path = []) => ({ distance, text, maneuver: { type }, at: { lat, lon }, path });

test('route preview: only the time (or steps when short), no crossing count and no "do not know" line', () => {
  setUnits('steps');
  const steps = [step('depart', 51, 0, 'walk ahead', 200), step('turn', 51, 0.002, 'cross the road, then turn left', 150),
    step('turn', 51.001, 0.002, 'take the zebra crossing', 100), step('arrive', 51.002, 0.002, 'your destination', 0)];
  assert.equal(routePreview({ distance: 450, duration: 360, steps }), 'About 6 minutes.');
  assert.equal(routePreview({ distance: 140, duration: 120, steps: steps.slice(0, 2) }), '200 steps.');
  assert.equal(routePreview({ distance: 600, duration: 480, steps: [steps[0], steps[3]] }), 'About 8 minutes.');
});

function walker(route, opts = {}) {
  let t = 0, cb; const said = [];
  const nav = new Navigator({ say: (x) => said.push(x), providers: { route: async () => route }, getPosition: async () => ({ lat: 51, lon: 0 }),
    watch: (f) => { cb = f; return 1; }, unwatch: () => {}, now: () => t, ...opts });
  nav.begin({ lat: 51, lon: 0 }, { name: 'Dest', lat: 51, lon: 0.003 }, route, true, true);
  said.length = 0;
  return { nav, said, at: (ms) => { t = ms; }, fix: (lat, lon, accuracy) => cb({ lat, lon, accuracy }) };
}
const L = () => ({ distance: 330, duration: 280, source: 'google', steps: [
  step('depart', 51, 0, 'walk ahead', 110, [{ lat: 51, lon: 0 }, { lat: 51, lon: 0.0015 }]),
  step('turn', 51, 0.0015, 'turn left', 110, [{ lat: 51, lon: 0.0015 }, { lat: 51.001, lon: 0.0015 }]),
  step('arrive', 51.001, 0.0015, 'your destination', 0)] });

test('weak GPS: worse than 25 m for 10 s is said once', () => {
  const w = walker(L());
  w.at(0); w.fix(51, 0.0002, 30);
  w.at(9000); w.fix(51, 0.0003, 35); assert.ok(!w.said.includes(WEAK_GPS_TEXT), 'not before 10 s');
  w.at(10500); w.fix(51, 0.0004, 30); assert.equal(w.said.filter((x) => x === WEAK_GPS_TEXT).length, 1);
  w.at(20000); w.fix(51, 0.0005, 40); assert.equal(w.said.filter((x) => x === WEAK_GPS_TEXT).length, 1, 'once');
  w.at(21000); w.fix(51, 0.0006, 8); assert.equal(w.said.at(-1), 'Location signal is back.');
  assert.equal(WEAK_GPS_TEXT, 'GPS is weak here, so directions may be late.');
});

test('weak GPS: "turn now" waits for a second fix that agrees', () => {
  const w = walker(L());
  w.at(0); w.fix(51, 0.0002, 30); w.at(11000); w.fix(51, 0.0004, 30); // weak, said
  w.at(12000); w.fix(51, 0.00148, 30);
  assert.ok(!w.said.some((x) => /now\.$/.test(x)), 'one weak fix on the turn is not enough');
  w.at(13000); w.fix(51, 0.00149, 30);
  assert.match(w.said.at(-1), /^Turn left now\./);
  const g = walker(L());
  g.at(0); g.fix(51, 0.00149, 5);
  assert.match(g.said.at(-1), /^Turn left now\./, 'with good GPS one fix is enough, as before');
});

test('arrival is careful, never "you have arrived"', () => {
  const w = walker(L());
  w.at(0); w.fix(51, 0.00149, 5);
  w.at(5000); w.fix(51.00095, 0.0015, 5);
  assert.equal(w.said.at(-1), ARRIVE_TEXT);
  assert.equal(ARRIVE_TEXT, 'You should be near your destination. It may be a few steps either way.');
  assert.equal(w.nav.active, false);
  assert.ok(!w.said.some((x) => /have arrived/i.test(x)));
  assert.equal(isSafeText('You have arrived at Tesco.'), false, 'banned');
});

const osmRoute = { routes: [{ distance: 100, duration: 80, legs: [{ steps: [
  { distance: 100, name: 'Mill Lane', maneuver: { type: 'depart', location: [0, 51] }, geometry: { coordinates: [[0, 51], [0.001, 51]] } },
  { distance: 0, name: '', maneuver: { type: 'arrive', location: [0.001, 51] }, geometry: { coordinates: [] } }] }] }] };
const osmPlace = [{ lat: '51', lon: '0.001', display_name: 'Cafe, Mill Lane', boundingbox: ['51', '51', '0', '0'] }];
function net(googleFails) {
  return async (url) => {
    if (url.includes('googleapis.com')) {
      if (googleFails === 'network') throw new TypeError('Failed to fetch');
      return { ok: false, status: googleFails, json: async () => ({}) };
    }
    if (url.includes('nominatim')) return { ok: true, json: async () => osmPlace };
    return { ok: true, json: async () => osmRoute };
  };
}

for (const fail of [429, 403, 'network']) {
  test(`Google ${fail === 'network' ? 'network error' : fail}: falls back to OpenStreetMap with one spoken line`, async () => {
    const heard = []; const logged = []; let t = 0;
    const p = makeProviders({ googleKey: 'k', fetchFn: net(fail), notify: (x) => heard.push(x), onFallback: (what) => logged.push(what), now: () => t });
    const place = await p.geocode('cafe', { lat: 51, lon: 0 });
    const route = await p.route({ lat: 51, lon: 0 }, place);
    assert.equal(place.source, 'osm'); assert.equal(route.source, 'osm');
    assert.deepEqual(logged, ['place search', 'route']);
    assert.deepEqual(heard, [FALLBACK_TEXT], 'said once, not for each request');
    t = 61000; await p.route({ lat: 51, lon: 0 }, place);
    assert.equal(heard.length, 2, 'said again a minute later, if it is still failing');
  });
}

test('the fallback line is the agreed wording, and Google working says nothing', async () => {
  assert.equal(FALLBACK_TEXT, 'Google directions are not available, using backup maps.');
  const heard = [];
  const ok = async (url) => ({ ok: true, json: async () => (url.includes('places') ? { places: [{ displayName: { text: 'Cafe' }, formattedAddress: 'Mill Lane', location: { latitude: 51, longitude: 0.001 } }] } : {}) });
  const p = makeProviders({ googleKey: 'k', fetchFn: ok, notify: (x) => heard.push(x) });
  assert.equal((await p.geocode('cafe', null)).source, 'google');
  assert.deepEqual(heard, []);
});
