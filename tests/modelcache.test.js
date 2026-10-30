// Models are kept on the phone after the first download, refreshed in the background when the site's file changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelBytes, warmModel, CACHE_NAME } from '../docs/js/modelcache.js';

function fakeCaches() {
  const store = new Map(); const opened = [];
  const cache = {
    match: async (u) => store.get(u)?.clone() ?? undefined,
    put: async (u, r) => { store.set(u, r); },
  };
  return { store, opened, caches: { open: async (n) => { opened.push(n); return cache; } } };
}
const resp = (bytes, etag) => new Response(new Uint8Array(bytes), { status: 200, headers: { etag } });

test('first load downloads and stores; the second comes from the phone with no wait on the network', async () => {
  const { store, opened, caches } = fakeCaches(); const calls = [];
  const fetchFn = async (u, o) => { calls.push(o?.cache || 'normal'); return resp([1, 2, 3], '"a"'); };
  assert.deepEqual([...await modelBytes('m.onnx', { caches, fetchFn })], [1, 2, 3]);
  assert.equal(opened[0], CACHE_NAME);
  assert.ok(store.has('m.onnx'));
  const offline = async (u, o) => { calls.push(o?.cache || 'normal'); throw new Error('offline'); };
  assert.deepEqual([...await modelBytes('m.onnx', { caches, fetchFn: offline })], [1, 2, 3], 'works with no network');
});

test('a replaced model on the site is picked up for the next start', async () => {
  const { store, caches } = fakeCaches();
  await modelBytes('m.onnx', { caches, fetchFn: async () => resp([1], '"old"') });
  const first = await modelBytes('m.onnx', { caches, fetchFn: async () => resp([9, 9], '"new"') });
  assert.deepEqual([...first], [1], 'this start uses the stored copy');
  await new Promise((r) => setTimeout(r, 10)); // the background check
  const next = await modelBytes('m.onnx', { caches, fetchFn: async () => resp([9, 9], '"new"') });
  assert.deepEqual([...next], [9, 9], 'the next start has the new model');
  assert.ok(store.has('m.onnx'));
});

test('no Cache Storage (private window): straight from the network; a failed download is an error', async () => {
  const bytes = await modelBytes('m.onnx', { caches: undefined, fetchFn: async () => resp([5], '"x"') });
  assert.deepEqual([...bytes], [5]);
  await assert.rejects(modelBytes('m.onnx', { caches: undefined, fetchFn: async () => new Response('', { status: 404 }) }));
});

test('warming fills the cache once and does not download again', async () => {
  const { caches } = fakeCaches(); let n = 0;
  const fetchFn = async () => { n += 1; return resp([1], '"a"'); };
  assert.equal(await warmModel('m.onnx', { caches, fetchFn }), true);
  assert.equal(await warmModel('m.onnx', { caches, fetchFn }), false);
  assert.equal(n, 1);
});
