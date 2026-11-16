// Guard: weights trained on Mapillary Vistas (non-commercial) are prefixed "ncseg_" and must never be shipped with the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';

test('no ncseg_ (non-commercial) weights in docs/models', () => {
  const dir = new URL('../docs/models/', import.meta.url);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  assert.deepEqual(files.filter((f) => f.toLowerCase().startsWith('ncseg_')), []);
});

test('the app does not reference ncseg_ files', () => {
  const dir = new URL('../docs/js/', import.meta.url);
  const hits = readdirSync(dir).filter((f) => f.endsWith('.js')).filter((f) => {
    return readFileText(new URL(f, dir)).toLowerCase().includes('ncseg_');
  });
  assert.deepEqual(hits, []);
});

import { readFileSync } from 'node:fs';
function readFileText(u) { return readFileSync(u, 'utf8'); }
