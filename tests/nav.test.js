import test from 'node:test';
import assert from 'node:assert/strict';
import { haversine, bearing, compass, distanceToPath, roundMetres, instructionText, Navigator } from '../docs/js/nav.js';

test('haversine ~111 km per degree of latitude', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 200);
});
test('bearing and compass', () => {
  assert.equal(compass(bearing({ lat: 51, lon: 0 }, { lat: 51.01, lon: 0 })), 'north');
  assert.equal(compass(bearing({ lat: 51, lon: 0 }, { lat: 51, lon: 0.01 })), 'east');
});
test('distance to path', () => {
  const path = [{ lat: 51, lon: 0 }, { lat: 51, lon: 0.002 }];
  const d = distanceToPath({ lat: 51.0003, lon: 0.001 }, path);
  assert.ok(d > 30 && d < 36, String(d));
});
test('wording', () => {
  assert.equal(roundMetres(8), 'a few metres');
  assert.equal(roundMetres(43), '40 metres');
  assert.equal(roundMetres(260), '250 metres');
  assert.equal(instructionText({ name: 'High Street', maneuver: { type: 'turn', modifier: 'left' } }), 'turn left onto High Street');
  assert.equal(instructionText({ name: '', maneuver: { type: 'turn', modifier: 'slight right' } }), 'keep right');
  assert.equal(instructionText({ maneuver: { type: 'arrive' } }), 'you have arrived');
});

function fakeNet(routeSteps) {
  return async (url) => {
    if (url.includes('nominatim')) return { ok: true, json: async () => [{ lat: '51.0', lon: '0.002', display_name: 'Test Cafe, High Street, Town' }] };
    return { ok: true, json: async () => ({ routes: [{ distance: 220, duration: 180, legs: [{ steps: routeSteps }] }] }) };
  };
}
const steps = [
  { distance: 110, name: 'Mill Lane', maneuver: { type: 'depart', bearing_after: 90, location: [0, 51] }, geometry: { coordinates: [[0, 51], [0.0015, 51]] } },
  { distance: 110, name: 'High Street', maneuver: { type: 'turn', modifier: 'left', location: [0.0015, 51] }, geometry: { coordinates: [[0.0015, 51], [0.0015, 51.001]] } },
  { distance: 0, name: '', maneuver: { type: 'arrive', location: [0.0015, 51.001] }, geometry: { coordinates: [[0.0015, 51.001]] } },
];

test('navigator speaks route, warning, turn and arrival', async () => {
  const said = []; let cb;
  const nav = new Navigator({
    say: (t) => said.push(t), fetchFn: fakeNet(steps),
    getPosition: async () => ({ lat: 51, lon: 0 }),
    watch: (f) => { cb = f; return 1; }, unwatch: () => {},
  });
  assert.equal(await nav.start('test cafe'), true);
  assert.match(said.join(' | '), /Going to Test Cafe/);
  assert.match(said.join(' | '), /First, walk along Mill Lane/);
  cb({ lat: 51, lon: 0.0010, accuracy: 10 }); // ~35 m from turn
  assert.match(said.at(-1), /^In \d+ metres, turn left onto High Street/);
  cb({ lat: 51, lon: 0.00145, accuracy: 10 });
  assert.match(said.at(-1), /Turn left onto High Street now/);
  cb({ lat: 51.0010, lon: 0.0015, accuracy: 10 });
  assert.match(said.at(-1), /arrived/);
  assert.equal(nav.active, false);
});

test('poor GPS fixes are ignored and cancel works', async () => {
  const said = []; let cb;
  const nav = new Navigator({ say: (t) => said.push(t), fetchFn: fakeNet(steps), getPosition: async () => ({ lat: 51, lon: 0 }), watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
  await nav.start('x'); const n = said.length;
  cb({ lat: 51, lon: 0.00145, accuracy: 200 });
  assert.equal(said.length, n);
  assert.equal(nav.cancel(), true);
  assert.equal(said.at(-1), 'Navigation cancelled.');
});

test('unknown place is reported', async () => {
  const said = [];
  const nav = new Navigator({ say: (t) => said.push(t), fetchFn: async () => ({ ok: true, json: async () => [] }), getPosition: async () => ({ lat: 51, lon: 0 }), watch: () => 1, unwatch: () => {} });
  assert.equal(await nav.start('nowhere'), false);
  assert.match(said.at(-1), /could not find nowhere/);
});

test('geocode keeps the search ranking (nearest-match picked the wrong place for Cabot Circus)', async () => {
  const { geocode } = await import('../docs/js/nav.js');
  const f = async () => ({ ok: true, json: async () => [{ lat: '51.458', lon: '-2.582', display_name: 'Cabot Circus, George White Street' }, { lat: '51.4545', lon: '-2.5870', display_name: 'Narrow Weir, Finzels Reach' }] });
  const g = await geocode('cabot circus', { lat: 51.4545, lon: -2.5879 }, f);
  assert.equal(g.name, 'Cabot Circus, George White Street');
});
test('tiny consecutive steps are spoken together', async () => {
  const said = []; let cb;
  const st = [
    { distance: 50, name: 'A', maneuver: { type: 'depart', bearing_after: 90, location: [0, 51] }, geometry: { coordinates: [[0, 51], [0.0007, 51]] } },
    { distance: 5, name: 'B', maneuver: { type: 'turn', modifier: 'left', location: [0.0007, 51] }, geometry: { coordinates: [[0.0007, 51], [0.0007, 51.00004]] } },
    { distance: 80, name: 'C', maneuver: { type: 'turn', modifier: 'right', location: [0.0007, 51.00004] }, geometry: { coordinates: [[0.0007, 51.00004], [0.0007, 51.0008]] } },
    { distance: 0, name: '', maneuver: { type: 'arrive', location: [0.0007, 51.0008] }, geometry: { coordinates: [[0.0007, 51.0008]] } },
  ];
  const nav = new Navigator({ say: (t) => said.push(t), fetchFn: fakeNet(st), getPosition: async () => ({ lat: 51, lon: 0 }), watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
  await nav.start('x');
  cb({ lat: 51, lon: 0.00069, accuracy: 5 });
  assert.match(said.at(-1), /Turn left onto B now, then turn right onto C\./);
  assert.equal(nav.idx, 3);
});

test('google route is converted to navigator steps, with street names and an arrival step', async () => {
  const { googleRoute } = await import('../docs/js/nav.js');
  const f = async () => ({ ok: true, json: async () => ({ routes: [{ distanceMeters: 300, duration: '240s', legs: [{ steps: [
    { distanceMeters: 100, startLocation: { latLng: { latitude: 51, longitude: 0 } }, navigationInstruction: { instructions: 'Head east on Mill Lane' }, polyline: { geoJsonLinestring: { coordinates: [[0, 51], [0.0015, 51]] } } },
    { distanceMeters: 200, startLocation: { latLng: { latitude: 51, longitude: 0.0015 } }, navigationInstruction: { instructions: 'Turn left onto High Street\nTake the stairs' }, polyline: { geoJsonLinestring: { coordinates: [[0.0015, 51], [0.0015, 51.002]] } } },
  ] }] }] }) });
  const r = await googleRoute({ lat: 51, lon: 0 }, { lat: 51.002, lon: 0.0015 }, f, 'KEY');
  assert.equal(r.duration, 240);
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[1].text, 'turn left onto High Street, then take the stairs');
  assert.equal(r.steps[2].maneuver.type, 'arrive');
});

test('falls back to OpenStreetMap when Google fails', async () => {
  const { makeProviders } = await import('../docs/js/nav.js');
  const seen = [];
  const f = async (url) => {
    if (url.includes('googleapis.com')) return { ok: false, status: 403, json: async () => ({}) };
    if (url.includes('nominatim')) return { ok: true, json: async () => [{ lat: '51.0', lon: '0.002', display_name: 'Test Cafe, High Street, Town' }] };
    return { ok: true, json: async () => ({ routes: [{ distance: 220, duration: 180, legs: [{ steps }] }] }) };
  };
  const p = makeProviders({ googleKey: 'KEY', fetchFn: f, onFallback: (w) => seen.push(w) });
  const g = await p.geocode('cafe', { lat: 51, lon: 0 });
  assert.equal(g.source, 'osm');
  const r = await p.route({ lat: 51, lon: 0 }, g);
  assert.equal(r.source, 'osm');
  assert.deepEqual(seen, ['place search', 'route']);
});

test('google is used first when it works', async () => {
  const { makeProviders } = await import('../docs/js/nav.js');
  const f = async () => ({ ok: true, json: async () => ({ places: [{ displayName: { text: 'Wills Memorial Building' }, formattedAddress: 'Queens Rd, Bristol', location: { latitude: 51.456, longitude: -2.6046 } }] }) });
  const g = await makeProviders({ googleKey: 'KEY', fetchFn: f }).geocode('wills', { lat: 51.45, lon: -2.58 });
  assert.equal(g.source, 'google');
  assert.equal(g.name, 'Wills Memorial Building, Queens Rd');
});

test('compass and vague words are removed from provider text', async () => {
  const { plainWords } = await import('../docs/js/nav.js');
  assert.equal(plainWords('Head north-west on Temple Meads - Castle Park'), 'walk along Temple Meads - Castle Park');
  assert.equal(plainWords('Head east'), 'walk ahead');
  assert.equal(plainWords('Turn slightly left onto High Street'), 'keep left onto High Street');
  assert.equal(plainWords('Slight right toward Park Street'), 'keep right toward Park Street');
  assert.equal(plainWords('Turn left onto Westbury Road'), 'Turn left onto Westbury Road');
});

test('orientation check says right way, wrong way, or which side', async () => {
  const run = async (move) => {
    const said = []; let cb;
    const nav = new Navigator({ say: (t) => said.push(t), fetchFn: fakeNet(steps), getPosition: async () => ({ lat: 51, lon: 0 }), watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
    await nav.start('x'); const n = said.length;
    cb({ lat: 51, lon: 0, accuracy: 5 }); cb({ ...move, accuracy: 5 });
    return said.slice(n).join(' ');
  };
  assert.match(await run({ lat: 51, lon: 0.00015 }), /right way/);           // route runs east
  assert.match(await run({ lat: 51, lon: -0.00015 }), /Wrong way/);
  assert.match(await run({ lat: 51.00015, lon: 0 }), /to your right/);       // walking north, route is east
  assert.match(await run({ lat: 50.99985, lon: 0 }), /to your left/);        // walking south, route is east
});
