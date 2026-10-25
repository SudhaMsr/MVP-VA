import test from 'node:test';
import assert from 'node:assert/strict';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import { Navigator, pointAhead, haversine, distanceToPath } from '../docs/js/nav.js';

const lat0 = 51.4545, lon0 = -2.5879, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180), mLat = 110574;
const P = (e, n) => ({ lat: lat0 + n / mLat, lon: lon0 + e / mLon }); // east/north metres from a start point
const step = (type, a, path, text, distance) => ({ distance, name: '', text, maneuver: { type, location: [a.lon, a.lat] }, at: a, path });

function walker(route, opts = {}) {
  const said = []; const traces = []; let cb; let clock = 1_000_000; const rerouted = [];
  const realNow = Date.now; Date.now = () => clock;
  const nav = new Navigator({
    say: (t, k) => said.push(t), now: () => clock, trace: (f) => traces.push(f), ...opts,
    providers: { route: async (...a) => { rerouted.push(a); return route; }, geocode: async () => ({ ...P(300, 0), name: 'Dest' }) },
    getPosition: async () => P(0, 0), watch: (f) => { cb = f; return 1; }, unwatch: () => {},
  });
  return { nav, said, traces, rerouted, fix: (e, n, accuracy = 8) => cb({ ...P(e, n), accuracy }), at: (ms) => { clock = 1_000_000 + ms; }, done: () => { Date.now = realNow; } };
}

test('pointAhead follows the route line, round bends, not a straight line', () => {
  const path = [P(0, 0), P(50, 0), P(50, 50)];
  const a = pointAhead(path, P(10, 0), 30);
  assert.ok(Math.abs(haversine(a, P(40, 0))) < 0.5, 'straight part: 30 m on is 40 m east');
  const b = pointAhead(path, P(40, 0), 30); // 10 m to the corner, then 20 m north
  assert.ok(haversine(b, P(50, 20)) < 0.5, 'goes round the corner');
  const c = pointAhead(path, P(30, 8), 30); // 8 m off the line: measured from the nearest point on it
  assert.ok(haversine(c, P(50, 10)) < 0.5);
  const end = pointAhead(path, P(50, 45), 30);
  assert.ok(haversine(end, P(50, 50)) < 0.5, 'never beyond the end of the route');
  assert.equal(pointAhead([], P(0, 0)), null);
});

test('a walker following a BENDING first leg is told they are going the right way (not "the route is to your left")', async () => {
  // East for 30 m, then north for 100 m to the turn. A straight line to the turn points almost north.
  const route = { distance: 230, duration: 180, source: 'google', steps: [
    step('depart', P(0, 0), [P(0, 0), P(30, 0), P(30, 100)], 'walk ahead', 130),
    step('turn', P(30, 100), [P(30, 100), P(130, 100)], 'turn right', 100),
    step('arrive', P(130, 100), [], 'you have arrived', 0)] };
  const w = walker(route);
  try {
    await w.nav.start('x'); w.said.length = 0;
    w.fix(2, 0); w.fix(8, 0); w.fix(13, 0); // walking east along the first part of the leg
    assert.deepEqual(w.said, ['You are going the right way.']);
  } finally { w.done(); }
});

test('walking the wrong way along the route is still caught, on a bend too', async () => {
  const route = { distance: 230, duration: 180, source: 'google', steps: [
    step('depart', P(0, 0), [P(0, 0), P(30, 0), P(30, 100)], 'walk ahead', 130),
    step('turn', P(30, 100), [P(30, 100), P(130, 100)], 'turn right', 100),
    step('arrive', P(130, 100), [], 'you have arrived', 0)] };
  const w = walker(route);
  try {
    await w.nav.start('x'); w.said.length = 0;
    w.fix(20, 0); w.fix(14, 0); w.fix(8, 0); // walking west, back towards the start
    assert.deepEqual(w.said, ['Wrong way. Turn around.']);
  } finally { w.done(); }
});

const straight = () => ({ distance: 300, duration: 240, source: 'google', steps: [
  step('depart', P(0, 0), [P(0, 0), P(300, 0)], 'walk ahead', 300), step('arrive', P(300, 0), [], 'you have arrived', 0)] });

test('imprecise GPS (accuracy 50 m) is not called "off route" when the fix is 45 m from the line', async () => {
  const w = walker(straight());
  try {
    await w.nav.start('x'); w.said.length = 0;
    for (let i = 0; i < 4; i++) { w.at(20000 * (i + 1)); w.fix(60 + i, 45, 50); }
    assert.ok(!w.said.some((t) => /Off route/.test(t)), 'GPS this loose could easily be 45 m out');
    assert.equal(w.rerouted.length, 1, 'only the first route was fetched');
  } finally { w.done(); }
});

test('a precise fix well off the line (accuracy 8 m, 45 m away) still triggers a new route', async () => {
  const w = walker(straight());
  try {
    await w.nav.start('x'); w.said.length = 0;
    for (let i = 0; i < 3; i++) { w.at(20000 * (i + 1)); w.fix(60 + i, 45, 8); }
    assert.ok(w.said.some((t) => /Off route/.test(t)));
  } finally { w.done(); }
});

test('a weak location signal is announced once after 15 s, and its return is announced', async () => {
  const w = walker(straight());
  try {
    await w.nav.start('x'); w.said.length = 0;
    w.at(1000); w.fix(40, 0, 100); assert.equal(w.said.length, 0, 'not yet: could be a blip');
    w.at(10000); w.fix(41, 0, 120); assert.equal(w.said.length, 0);
    w.at(17000); w.fix(42, 0, 100); assert.deepEqual(w.said, ['My location signal is weak. I may be late with turns, so go carefully.']);
    w.at(25000); w.fix(43, 0, 100); assert.equal(w.said.length, 1, 'said once, not every fix');
    w.at(30000); w.fix(44, 0, 10); assert.equal(w.said.at(-1), 'Location signal is back.');
  } finally { w.done(); }
});

test('when location updates simply stop, the walker is told once; a new fix resets it', async () => {
  const w = walker(straight());
  try {
    await w.nav.start('x'); w.said.length = 0;
    w.at(20000); w.nav.tick(); assert.equal(w.said.length, 0);
    w.at(31000); w.nav.tick(); assert.deepEqual(w.said, ['I have not had a location update for a while. Please go carefully.']);
    w.at(40000); w.nav.tick(); assert.equal(w.said.length, 1, 'once');
    w.at(41000); w.fix(40, 0); w.at(80000); w.nav.tick();
    assert.equal(w.said.filter((t) => /not had a location update/.test(t)).length, 2, 'speaks again after a later silence');
  } finally { w.done(); }
});

test('tick does nothing when navigation is not active', async () => {
  const w = walker(straight());
  try { w.at(100000); w.nav.tick(); assert.equal(w.said.length, 0); } finally { w.done(); }
});

test('every accepted fix is traced (position, accuracy, step, distance to the turn); poor fixes are not', async () => {
  const w = walker(straight());
  try {
    await w.nav.start('x');
    w.at(1000); w.fix(100, 0, 8); w.at(2000); w.fix(110, 0, 200);
    assert.equal(w.traces.length, 1);
    assert.equal(w.traces[0].accuracy, 8); assert.equal(w.traces[0].step, 1); assert.equal(w.traces[0].toTurn, 200);
  } finally { w.done(); }
});

test('the Google geocoder no longer says an address twice, and keeps the full address', async () => {
  const { googleGeocodeMany } = await import('../docs/js/nav.js');
  const f = async () => ({ ok: true, json: async () => ({ places: [{ displayName: { text: '25 Lakeside' }, formattedAddress: '25 Lakeside, Bristol BS16 3EE, UK', location: { latitude: 51.5, longitude: -2.55 } }] }) });
  const [r] = await googleGeocodeMany('25 lakeside', null, f, 'KEY', 1);
  assert.equal(r.name, '25 Lakeside');
  assert.equal(r.address, '25 Lakeside, Bristol BS16 3EE, UK');
});

import { locationMessage } from '../docs/js/nav.js';
test('location problems are described by their real reason, not always "check permission"', () => {
  assert.match(locationMessage({ code: 1 }), /blocked/);
  assert.match(locationMessage({ code: 2 }), /location services/);
  assert.doesNotMatch(locationMessage({ code: 2 }), /permission/i);
  assert.match(locationMessage({ code: 3 }), /too long/);
  assert.match(locationMessage(new Error('x')), /try again/);
  assert.match(locationMessage({ code: 1 }, 'Could not save.'), /^Could not save\./);
});
