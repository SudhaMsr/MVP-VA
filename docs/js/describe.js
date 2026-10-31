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
  cat: ['cat', 'cats'], horse: ['horse', 'horses'], sheep: ['sheep', 'sheep'], cow: ['cow', 'cows'], suitcase: ['suitcase', 'suitcases'],
  skateboard: ['skateboard', 'skateboards'], parking_meter: ['parking meter', 'parking meters'], couch: ['sofa', 'sofas'], dining_table: ['table', 'tables'],
  stairs: ['stairs', 'stairs', 'none'], blind_road: ['tactile paving', 'tactile paving', 'none'],
};
// Risks first: when there is a lot to say, these are kept and the rest dropped.
const IMPORTANCE = ['stairs', 'car', 'truck', 'bus', 'motorcycle', 'tricycle', 'bicycle', 'red_light', 'manhole', 'person', 'dog',
  'roadblock', 'guard_rail', 'crosswalk', 'green_light', 'pole', 'warning_column', 'reflective_cone', 'tree', 'bench', 'chair',
  'horse', 'cow', 'sheep', 'cat', 'ashcan', 'plant_pot', 'suitcase', 'skateboard', 'parking_meter', 'couch', 'dining_table', 'electrical_box', 'bicycle_rack', 'fire_hydrant', 'blind_road'];
const rank = (n) => { const i = IMPORTANCE.indexOf(n); return i < 0 ? 99 : i; };

import { TERTIARY } from './config.js';
// Anything the third (COCO) lane can report is named from its own label, e.g. cell_phone -> "cell phone".
for (const n of TERTIARY.classes) if (!NOUNS[n]) { const w = n.replace(/_/g, ' '); NOUNS[n] = [w, n === 'sheep' ? 'sheep' : `${w}s`]; }
const article = (noun) => (/^[aeiou]/.test(noun) ? 'an' : 'a');
const SIDES = [['ahead', 'Straight ahead'], ['left', 'On your left'], ['right', 'On your right']];

export const NOTHING = 'I cannot see anything I recognise. That does not mean the way is clear, so use your cane or guide dog.';
export const NO_CAMERA = 'The camera is not on. Tap start first, then ask me again.';

// tracks: from the tracker (box, name, dist, hits). Returns the sentence to speak.
// path: the free-space advice for the walker's way ahead ({text}), null when it is open, undefined when unknown.
export function pathSentence(path) {
  if (path === undefined) return '';
  if (!path) return 'The way ahead looks clear.';
  return path.stop ? 'No clear way ahead. Stop.' : `Ahead is blocked. ${path.text}`;
}

export function describeScene(tracks, frameW, { minHits = 2, maxItems = 5, path } = {}) {
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
  return `${pathSentence(path)} ${parts.join(' ')}${more}`.trim();
}

// "Is there a bench?" / "find a bin" (object search, from the NAVI AI idea in RESEARCH.md).
// Answers from what the camera sees right now; honest when it cannot see one, or does not know the word.
const ASK = { bin: 'ashcan', 'rubbish bin': 'ashcan', 'litter bin': 'ashcan', 'trash can': 'ashcan', seat: 'bench', crossing: 'crosswalk',
  'zebra crossing': 'crosswalk', 'pedestrian crossing': 'crosswalk', steps: 'stairs', staircase: 'stairs', bike: 'bicycle', 'push bike': 'bicycle',
  motorbike: 'motorcycle', someone: 'person', anybody: 'person', anyone: 'person', man: 'person', woman: 'person', lorry: 'truck', van: 'truck',
  'traffic light': ['red_light', 'green_light', 'traffic_light'], 'traffic lights': ['red_light', 'green_light', 'traffic_light'], sofa: 'couch', table: 'dining_table',
  hydrant: 'fire_hydrant', cone: 'reflective_cone', barrier: ['roadblock', 'guard_rail'], post: ['pole', 'warning_column'], bollard: 'warning_column' };
export function objectNames(query) {
  const q = String(query || '').toLowerCase().replace(/[?.!]/g, '').replace(/^(?:a|an|the|any|some)\s+/, '').trim();
  if (!q) return [];
  const tryWord = (w) => {
    if (ASK[w]) return [].concat(ASK[w]);
    const hit = Object.entries(NOUNS).filter(([name, [one, many]]) => w === one || w === many || w === name.replace(/_/g, ' '));
    return hit.map(([name]) => name);
  };
  let names = tryWord(q);
  if (!names.length && q.endsWith('s')) names = tryWord(q.slice(0, -1));
  return names;
}
export function findObject(tracks, query, frameW, { minHits = 2 } = {}) {
  const q = String(query || '').toLowerCase().replace(/^(?:a|an|the|any|some)\s+/, '').replace(/[?.!]/g, '').trim();
  const names = objectNames(q);
  if (!names.length) return `I cannot recognise ${q || 'that'} yet. I can look for things like a bench, a bin, a crossing, a person, a car or stairs.`;
  const seen = (tracks || []).filter((t) => names.includes(t.name) && (t.hits ?? minHits) >= minHits)
    .sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
  const noun = NOUNS[names[0]] ? NOUNS[names[0]][0] : q;
  if (!seen.length) return `I cannot see ${NOUNS[names[0]]?.[2] === 'none' ? noun : `${article(noun)} ${noun}`} right now. Turn slowly, then ask again.`;
  const t = seen[0], dir = directionOf((t.box.x1 + t.box.x2) / 2, frameW);
  const n = NOUNS[t.name] ? NOUNS[t.name][0] : t.name.replace(/_/g, ' ');
  const where = dir === 'ahead' ? 'straight ahead' : `on your ${dir}`;
  const lead = NOUNS[t.name]?.[2] === 'none' ? cap(n) : `${cap(article(n))} ${n}`;
  return `Yes. ${lead}, ${where}${t.dist != null ? `, ${nearDistance(t.dist)}` : ''}.`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
