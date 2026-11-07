// Package B: installable, works without signal, updates safely, smaller site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OnlineWatch, updateNotice, OFFLINE_TEXT, ONLINE_TEXT, UPDATED_TEXT } from '../docs/js/pwa.js';
import { MODELS, pickModel, SECONDARY, TERTIARY, DEFAULT_MODEL } from '../docs/js/config.js';
import { isSafeText } from '../docs/js/safetext.js';

const docs = new URL('../docs/', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, docs), 'utf8');
const sw = read('sw.js');
const version = read('index.html').match(/<span id="ver">([0-9a-f]+)<\/span>/)[1];
const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

test('sw.js carries the same version as index.html (run: python3 tools/stamp.py)', () => {
  assert.equal(sw.match(/const VERSION = '([0-9a-f]+)';/)[1], version);
  assert.match(sw, /const CACHE = `va-shell-\$\{VERSION\}`/, 'the cache name changes with every release');
});

test('the offline app shell includes every script at its stamped address, the pages and the runtime', () => {
  for (const f of fs.readdirSync(new URL('js/', docs)).filter((x) => x.endsWith('.js'))) assert.ok(precache.includes(`js/${f}?v=${version}`), f);
  for (const p of ['./', 'index.html', 'privacy.html', 'limits.html', 'numbers.html', 'manifest.webmanifest', 'vendor/ort/ort.min.js', 'vendor/ort/ort-wasm-simd.wasm']) assert.ok(precache.includes(p), p);
  for (const u of precache) assert.ok(fs.existsSync(new URL(u === './' ? 'index.html' : u.split('?')[0], docs)), `${u} exists`);
  assert.ok(!precache.some((u) => u.includes('models/')), 'models are cached by modelcache.js, not here');
  assert.match(sw, /models.*return; \/\/ modelcache\.js handles models/);
});

test('the manifest makes the app installable', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Vision Assist'); assert.equal(m.short_name, 'Vision Assist');
  assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.display, 'standalone'); assert.equal(m.orientation, 'portrait');
  assert.equal(m.background_color, '#000000'); assert.equal(m.theme_color, '#000000');
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
  for (const s of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.includes(s), s);
  for (const i of m.icons) assert.ok(fs.existsSync(new URL(i.src, docs)), i.src);
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
  assert.match(html, /serviceWorker\.register\('sw\.js'\)/);
});

test('one service worker: the ?mt=1 isolation headers live in sw.js now', () => {
  assert.ok(!fs.existsSync(new URL('coi-sw.js', docs)));
  assert.match(sw, /Cross-Origin-Embedder-Policy/);
  assert.doesNotMatch(read('index.html'), /location\.reload\(\)[^]*running/, 'the page never reloads while running');
});

test('offline: said once at start or when it drops, "back" only after it was said', () => {
  const said = []; let now = 0;
  const w = new OnlineWatch({ say: (t) => said.push(t), now: () => now });
  w.start(true); assert.deepEqual(said, []);
  w.update(true); assert.deepEqual(said, []);
  w.update(false); assert.deepEqual(said, [OFFLINE_TEXT]);
  w.update(false); assert.equal(said.length, 1, 'no repeat while still offline');
  now = 5000; w.update(true); assert.deepEqual(said.at(-1), ONLINE_TEXT);
  now = 8000; w.update(false); assert.equal(said.length, 2, 'a flapping signal is not repeated within a minute');
  now = 9000; w.update(true); assert.equal(said.at(-1), ONLINE_TEXT, 'but "back" still follows');
  const s2 = []; const w2 = new OnlineWatch({ say: (t) => s2.push(t) }); w2.start(false);
  assert.deepEqual(s2, [OFFLINE_TEXT]);
  assert.equal(OFFLINE_TEXT, 'No internet. I can still spot obstacles, but directions and Google listening need signal.');
  assert.ok(isSafeText(OFFLINE_TEXT) && isSafeText(ONLINE_TEXT));
});

test('"Vision Assist has updated." once, on the first start of a new version', () => {
  const m = {}; const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } };
  assert.equal(updateNotice('aaa1111', st), '', 'very first start: nothing to compare with');
  assert.equal(updateNotice('aaa1111', st), '');
  assert.equal(updateNotice('bbb2222', st), UPDATED_TEXT);
  assert.equal(updateNotice('bbb2222', st), '');
  assert.equal(updateNotice('ccc3333', { getItem() { throw new Error('x'); } }), '');
  assert.equal(updateNotice('ccc3333', null), '');
});

test('only models that are on the site can be picked; unused ones are gone', () => {
  for (const f of ['best416.onnx', 'rod416.onnx', 'rod640.onnx']) assert.ok(!fs.existsSync(new URL(`models/${f}`, docs)), f);
  for (const [k, m] of Object.entries(MODELS)) for (const s of m.sizes) assert.ok(fs.existsSync(new URL(m.url(s), docs)), `${k} ${s}`);
  assert.ok(fs.existsSync(new URL(MODELS[SECONDARY.model].url(SECONDARY.size), docs)));
  assert.ok(fs.existsSync(new URL(MODELS[TERTIARY.model].url(TERTIARY.size), docs)));
  assert.deepEqual(pickModel(null, null, 320), { key: DEFAULT_MODEL, size: 320 });
  assert.deepEqual(pickModel('wotr', '416', 320), { key: 'wotr', size: 320 }, 'best416 is gone: fall back to 320');
  assert.deepEqual(pickModel('rod', '416', 320), { key: DEFAULT_MODEL, size: 320 }, 'rod files are gone');
  assert.deepEqual(pickModel('rod2', null, 320), { key: 'rod2', size: 416 });
});
