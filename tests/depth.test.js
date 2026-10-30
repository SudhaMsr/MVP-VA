import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, DEPTH } from '../docs/js/depth.js';

test('depth map is scaled to 0..1 with 1 = nearest; a flat map does not divide by zero', () => {
  assert.deepEqual([...normalise(Float32Array.from([2, 4, 6]))], [0, 0.5, 1]);
  assert.deepEqual([...normalise(Float32Array.from([3, 3]))], [0, 0]);
});

test('depth input size is a multiple of 14 (the model needs it)', () => assert.equal(DEPTH.size % 14, 0));
