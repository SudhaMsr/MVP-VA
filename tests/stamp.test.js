import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
test('index.html is stamped for the current scripts (run: python3 tools/stamp.py)', () => {
  const dir = new URL('../docs/js/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const ver = crypto.createHash('sha1').update(Buffer.concat(files.map((f) => fs.readFileSync(new URL(f, dir))))).digest('hex').slice(0, 7);
  const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`src="js/app.js?v=${ver}"`), 'stale stamp: scripts changed since tools/stamp.py was run');
  assert.ok(html.includes(`<span id="ver">${ver}</span>`));
});
