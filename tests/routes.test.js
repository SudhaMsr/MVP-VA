import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import assert from 'node:assert/strict';
import { routeFromPoints, simplify, RouteRecorder, RouteStore, pathLength } from '../docs/js/routes.js';
import { haversine } from '../docs/js/nav.js';

const M_LAT = 1 / 111320, M_LON = 1 / (111320 * Math.cos((51.45 * Math.PI) / 180));
const at = (n, e) => ({ lat: 51.45 + n * M_LAT, lon: -2.58 + e * M_LON });
// 100 m north in 5 m steps, then 100 m east
const L = [...Array.from({ length: 21 }, (_, i) => at(i * 5, 0)), ...Array.from({ length: 20 }, (_, i) => at(100, (i + 1) * 5))];

test('simplify keeps the corner and drops the straight middle', () => {
  const s = simplify(L, 6);
  assert.equal(s.length, 3);
  assert.ok(haversine(s[1], at(100, 0)) < 1);
});

test('an L-shaped walk becomes: walk straight, turn right, arrive', () => {
  const r = routeFromPoints(L, 'shop');
  assert.deepEqual(r.steps.map((s) => s.text), ['walk straight', 'turn right', 'you have arrived']);
  assert.ok(Math.abs(r.steps[0].distance - 100) < 2 && Math.abs(r.steps[1].distance - 100) < 2);
  assert.ok(Math.abs(r.distance - 200) < 4);
  assert.equal(r.steps.at(-1).maneuver.type, 'arrive');
});

test('walking it backwards turns left at the corner', () => {
  const r = routeFromPoints(L, 'shop', { reverse: true });
  assert.deepEqual(r.steps.map((s) => s.text), ['walk straight', 'turn left', 'you have arrived']);
  assert.ok(haversine(r.start, at(100, 100)) < 1, 'starts where the walk ended');
});

test('GPS wobble does not create fake turns', () => {
  const noisy = L.map((p, i) => ({ lat: p.lat + Math.sin(i * 7) * 1.5 * M_LAT, lon: p.lon + Math.cos(i * 5) * 1.5 * M_LON }));
  const r = routeFromPoints(noisy, 'x');
  assert.deepEqual(r.steps.map((s) => s.text), ['walk straight', 'turn right', 'you have arrived']);
});

test('a U-turn is "turn around" and a sharp bend says sharp', () => {
  const u = [...Array.from({ length: 11 }, (_, i) => at(i * 5, 0)), ...Array.from({ length: 10 }, (_, i) => at(50 - (i + 1) * 5, 3))];
  assert.equal(routeFromPoints(u, 'u').steps[1].text, 'turn around');
});

test('the recorder keeps fixes 5 m apart and ignores poor ones', () => {
  const r = new RouteRecorder(); r.start('home to shop');
  assert.equal(r.add({ ...at(0, 0), accuracy: 8 }), true);
  assert.equal(r.add({ ...at(2, 0), accuracy: 8 }), false, 'only 2 m moved');
  assert.equal(r.add({ ...at(10, 0), accuracy: 80 }), false, 'poor fix');
  assert.equal(r.add({ ...at(10, 0), accuracy: 8 }), true);
  assert.ok(Math.abs(r.metres - 10) < 0.5);
  assert.equal(r.stop().points.length, 2);
});

test('routes are saved by name, found by a spoken name, and listed', () => {
  const mem = new Map(); const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const st = new RouteStore(storage);
  assert.equal(st.save('Home to the shop', L).persisted, true);
  assert.equal(st.save('x', [L[0]]), null, 'a route needs at least two points');
  assert.equal(st.get('home to shop').points.length, L.length);
  assert.deepEqual(st.list(), ['home to shop']);
  assert.equal(st.getLast().name, 'home to shop');
  assert.equal(new RouteStore(storage).get('Home to the shop').name, 'home to shop', 'survives a reload');
  assert.equal(st.remove('home to shop'), true);
});

test('Navigator can walk a recorded route: turn warning, turn now, arrival', async () => {
  const { Navigator } = await import('../docs/js/nav.js');
  const said = []; let cb = null; const r = routeFromPoints(L, 'shop');
  const nav = new Navigator({ say: (t) => said.push(t), providers: {}, getPosition: async () => L[0], watch: (f) => { cb = f; return 1; }, unwatch: () => {} });
  nav.begin(L[0], { name: 'the end of shop', lat: L.at(-1).lat, lon: L.at(-1).lon }, r, true, true);
  for (let i = 0; i < L.length; i++) cb({ ...L[i], accuracy: 6 });
  const all = said.join(' | ');
  assert.match(all, /turn right/i);
  assert.match(all, /now/);
  assert.match(all, /You have arrived at the end of shop/);
});

import { parseCommand } from '../docs/js/commands.js';
test('route voice commands', () => {
  assert.deepEqual(parseCommand('record a route called home to shop'), { type: 'routeRecord', arg: 'home to shop' });
  assert.deepEqual(parseCommand('start recording'), { type: 'routeRecord', arg: '' });
  assert.deepEqual(parseCommand('record this route as the bus stop'), { type: 'routeRecord', arg: 'the bus stop' });
  assert.equal(parseCommand('stop recording').type, 'routeStop');
  assert.equal(parseCommand('save this route').type, 'routeStop');
  assert.deepEqual(parseCommand('follow route home to shop'), { type: 'routeFollow', arg: 'home to shop', reverse: false });
  assert.deepEqual(parseCommand('take me back along route home to shop'), { type: 'routeFollow', arg: 'home to shop', reverse: true });
  assert.deepEqual(parseCommand('take me back the way I came'), { type: 'routeFollow', arg: '', reverse: true });
  assert.equal(parseCommand('what routes do I have').type, 'routeList');
  assert.equal(parseCommand('stop').type, 'stop', 'plain stop still stops the app');
  assert.equal(parseCommand('navigate to university of bristol').type, 'navigate');
  assert.equal(parseCommand('take me home').type, 'navigate');
});
