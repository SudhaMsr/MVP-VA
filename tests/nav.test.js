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
  assert.equal(instructionText({ name: '', maneuver: { type: 'turn', modifier: 'slight right' } }), 'bear right');
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
  assert.match(said.join(' | '), /First, walk east on Mill Lane/);
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

test('geocode picks the match nearest the walker', async () => {
  const { geocode } = await import('../docs/js/nav.js');
  const f = async () => ({ ok: true, json: async () => [{ lat: '51.49', lon: '-2.63', display_name: 'Far Estate, X' }, { lat: '51.456', lon: '-2.603', display_name: 'Near Building, Y' }] });
  const g = await geocode('uni', { lat: 51.4545, lon: -2.5879 }, f);
  assert.equal(g.name, 'Near Building, Y');
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
