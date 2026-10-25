// "What is in front of me?" - a spoken summary of what the camera currently sees, on request.
// It is the on-demand partner of quiet mode: the app stays quiet, and the walker asks when they want more.
// Honest by design: it only lists what the detector recognised, and says so when it sees nothing.
import { directionOf } from './alerts.js';
import { nearDistance } from './units.js';

// name -> [singular, plural, article?]. Names are the detector's canonical class names.
const NOUNS = {
  person: ['person', 'people'], dog: ['dog', 'dogs'], bicycle: ['bicycle', 'bicycles'],
  car: ['car', 'cars'], truck: ['truck', 'trucks'], bus: ['bus', 'buses'], motorcycle: ['motorbike', 'motorbikes'], tricycle: ['tricycle', 'tricycles'],
  pole: ['pole', 'poles'], ashcan: ['bin', 'bins'], warning_column: ['warning post', 'warning posts'], reflective_cone: ['cone', 'cones'],
  roadblock: ['barrier', 'barriers'], guard_rail: ['barrier', 'barriers'], tree: ['tree', 'trees'], bench: ['bench', 'benches'],
  chair: ['chair', 'chairs'], plant_pot: ['plant pot', 'plant pots'], electrical_box: ['electrical box', 'electrical boxes'],
  bicycle_rack: ['bicycle rack', 'bicycle racks'], fire_hydrant: ['hydrant', 'hydrants'], manhole: ['manhole', 'manholes'],
  crosswalk: ['crossing', 'crossings'], red_light: ['red light', 'red lights'], green_light: ['green light', 'green lights'],
  stairs: ['stairs', 'stairs', 'none'], blind_road: ['tactile paving', 'tactile paving', 'none'],
};
// Risks first: when there is a lot to say, these are kept and the rest dropped.
const IMPORTANCE = ['stairs', 'car', 'truck', 'bus', 'motorcycle', 'tricycle', 'bicycle', 'red_light', 'manhole', 'person', 'dog',
  'roadblock', 'guard_rail', 'crosswalk', 'green_light', 'pole', 'warning_column', 'reflective_cone', 'tree', 'bench', 'chair',
  'ashcan', 'plant_pot', 'electrical_box', 'bicycle_rack', 'fire_hydrant', 'blind_road'];
const rank = (n) => { const i = IMPORTANCE.indexOf(n); return i < 0 ? 99 : i; };

const article = (noun) => (/^[aeiou]/.test(noun) ? 'an' : 'a');
const SIDES = [['ahead', 'Straight ahead'], ['left', 'On your left'], ['right', 'On your right']];

export const NOTHING = 'I cannot see anything I recognise. That does not mean the way is clear, so use your cane or guide dog.';
export const NO_CAMERA = 'The camera is not on. Tap start first, then ask me again.';

// tracks: from the tracker (box, name, dist, hits). Returns the sentence to speak.
export function describeScene(tracks, frameW, { minHits = 2, maxItems = 5 } = {}) {
  const seen = (tracks || []).filter((t) => NOUNS[t.name] && (t.hits ?? minHits) >= minHits);
  if (!seen.length) return NOTHING;
  // Group the same kind of thing on the same side: "2 people".
  const groups = new Map();
  for (const t of seen) {
    const dir = directionOf((t.box.x1 + t.box.x2) / 2, frameW);
    const key = `${t.name}|${dir}`;
    const g = groups.get(key) || { name: t.name, dir, count: 0, d: null };
    g.count += 1;
    if (t.dist != null) g.d = g.d == null ? t.dist : Math.min(g.d, t.dist);
    groups.set(key, g);
  }
  const kept = [...groups.values()].sort((a, b) => rank(a.name) - rank(b.name) || (a.d ?? 99) - (b.d ?? 99)).slice(0, maxItems);
  const parts = [];
  for (const [dir, lead] of SIDES) {
    const items = kept.filter((g) => g.dir === dir).sort((a, b) => (a.d ?? 99) - (b.d ?? 99));
    if (!items.length) continue;
    const phrases = items.map((g) => {
      const [one, many, mass] = NOUNS[g.name];
      const what = g.count > 1 ? `${g.count} ${many}` : mass === 'none' ? one : `${article(one)} ${one}`;
      return g.d != null ? `${what}, ${nearDistance(g.d)}` : what;
    });
    const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join('; ')}; and ${phrases.at(-1)}` : phrases[0];
    parts.push(`${lead}: ${joined}.`);
  }
  const more = groups.size > kept.length ? ' There is more, but those are the main things.' : '';
  return `${parts.join(' ')}${more}`;
}
