import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, letterbox, rgbaToTensor, iou } from '../docs/js/detector.js';

test('letterbox keeps aspect ratio and centres', () => {
  const lb = letterbox(1280, 720, 320);
  assert.equal(lb.w, 320);
  assert.equal(lb.h, 180);
  assert.equal(lb.dx, 0);
  assert.equal(lb.dy, 70);
});

test('rgbaToTensor makes planar RGB 0..1', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const t = rgbaToTensor(rgba, 2);
  assert.deepEqual(Array.from(t.slice(0, 4)), [1, 0, 0, 1]); // R plane
  assert.deepEqual(Array.from(t.slice(4, 8)), [0, 1, 0, 1]); // G plane
  assert.deepEqual(Array.from(t.slice(8, 12)), [0, 0, 1, 1]); // B plane
});

test('iou basics', () => {
  const a = { x1: 0, y1: 0, x2: 10, y2: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x1: 20, y1: 20, x2: 30, y2: 30 }), 0);
});

test('decode matches the Python reference on a real model output', () => {
  const meta = JSON.parse(readFileSync(new URL('./fixtures/out320.json', import.meta.url)));
  const buf = readFileSync(new URL('./fixtures/out320.f32', import.meta.url));
  const out = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const lb = { r: meta.r, dx: meta.dx, dy: meta.dy };
  const got = decode(out, meta.N, lb, meta.srcW, meta.srcH, 0.45, 0.5);
  assert.equal(got.length, meta.expected.length);
  for (let i = 0; i < got.length; i++) {
    const e = meta.expected[i];
    assert.equal(got[i].cls, e.cls);
    assert.ok(Math.abs(got[i].score - e.score) < 1e-4);
    for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(Math.abs(got[i][k] - e[k]) < 0.5, k);
  }
});

test('decode on empty output returns nothing', () => {
  const N = 10;
  const out = new Float32Array(24 * N);
  assert.deepEqual(decode(out, N, { r: 1, dx: 0, dy: 0 }, 320, 320, 0.45, 0.5), []);
});
