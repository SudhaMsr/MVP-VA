// 7 Nov: "I lost your location signal" was said while good fixes kept arriving. Now: only after 10 s with no fix,
// and "Location signal is back." when fixes return.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigator } from '../docs/js/nav.js';

const A = { lat: 51, lon: 0 }, B = { lat: 51, lon: 0.004 };
const route = { distance: 280, duration: 200, source: 'google', steps: [
  { distance: 280, name: '', text: 'walk ahead', maneuver: { type: 'depart', location: [0, 51] }, at: A, path: [A, B] },
  { distance: 0, name: '', text: 'you have arrived', maneuver: { type: 'arrive', location: [0.004, 51] }, at: B, path: [] }] };
async function setup() {
  const said = []; const h = { clock: 0 };
  const nav = new Navigator({ say: (t) => said.push(t), now: () => h.clock,
    providers: { route: async () => route, geocode: async () => ({ ...B, name: 'Dest' }) },
    getPosition: async () => A, watch: (f, e) => { h.fix = f; h.err = e; return 1; }, unwatch: () => {} });
  await nav.start('x'); said.length = 0;
  return { said, h };
}

test('errors mixed with good fixes never say "lost"', async () => {
  const { said, h } = await setup();
  for (h.clock = 1000; h.clock < 60000; h.clock += 1000) { h.fix({ ...A, accuracy: 8 }); h.err(); }
  assert.ok(!said.some((t) => /lost your location/.test(t)), JSON.stringify(said));
});

test('lost only after 10 s with no fix, then "back" when fixes return', async () => {
  const { said, h } = await setup();
  h.clock = 1000; h.fix({ ...A, accuracy: 8 });
  for (h.clock = 2000; h.clock <= 10000; h.clock += 1000) h.err();
  assert.ok(!said.some((t) => /lost your location/.test(t)), 'not yet at 9 s without a fix');
  h.clock = 12000; h.err();
  assert.equal(said.filter((t) => /lost your location/.test(t)).length, 1);
  h.clock = 15000; h.fix({ ...A, accuracy: 8 });
  assert.ok(said.includes('Location signal is back.'), JSON.stringify(said));
});
