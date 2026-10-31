// Object search: "is there a bench?" answered from what the camera sees now.
import test from 'node:test';
import { setUnits } from '../docs/js/units.js'; setUnits('metres');
import assert from 'node:assert/strict';
import { findObject, objectNames } from '../docs/js/describe.js';
import { parseCommand } from '../docs/js/commands.js';

const W = 640;
const t = (name, x, dist, hits = 3) => ({ name, hits, dist, box: { x1: x, y1: 200, x2: x + 60, y2: 300 } });

test("the walker's words are understood", () => {
  assert.deepEqual(parseCommand('is there a bench'), { type: 'find', arg: 'bench' });
  assert.deepEqual(parseCommand('find a bin'), { type: 'find', arg: 'bin' });
  assert.deepEqual(parseCommand('can you see any stairs'), { type: 'find', arg: 'stairs' });
  assert.deepEqual(parseCommand('look for a crossing'), { type: 'find', arg: 'crossing' });
  assert.equal(parseCommand('is there anything ahead').type, 'describe', 'still the scene description');
  assert.equal(parseCommand('navigate to the nearest pharmacy').type, 'navigate');
  assert.notEqual(parseCommand('find the nearest pharmacy').type, 'find', 'a place to go is not an object search');
  assert.deepEqual(objectNames('bins'), ['ashcan']);
  assert.deepEqual(objectNames('traffic lights'), ['red_light', 'green_light', 'traffic_light']);
});

test('found: nearest one, with side and distance', () => {
  const tracks = [t('bench', 20, 6), t('bench', 500, 3), t('person', 300, 2)];
  assert.equal(findObject(tracks, 'bench', W), 'Yes. A bench, on your right, about 3 metres.');
  assert.equal(findObject([t('stairs', 300, null)], 'steps', W), 'Yes. Stairs, straight ahead.');
});

test('not found, seen only once, or an unknown word: honest answers', () => {
  assert.equal(findObject([t('person', 300, 2)], 'bin', W), 'I cannot see a bin right now. Turn slowly, then ask again.');
  assert.equal(findObject([t('bench', 300, 2, 1)], 'bench', W), 'I cannot see a bench right now. Turn slowly, then ask again.', 'one frame is not enough');
  assert.match(findObject([], 'door', W), /^I cannot recognise door yet\./);
});
