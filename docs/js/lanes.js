// Two-model "lanes". The fast lane (old model) runs every frame: people, vehicles, poles, traffic lights.
// The slow lane (ROD model) runs every few frames and only contributes the classes the fast lane lacks:
// stairs, manholes, benches, chairs, guard rails... Its last result is reused for a short time in between.
export function filterAllowed(dets, allowed) {
  const set = new Set(allowed);
  return dets.filter((d) => set.has(d.name));
}

export function mergeLanes(primaryDets, slow, now, maxAgeMs) {
  if (!slow || slow.t == null || now - slow.t > maxAgeMs) return primaryDets;
  return primaryDets.concat(slow.dets);
}

// Slow-lane safety check for classes that cause a spoken fall-hazard warning (field test 31 Oct: the Phase 2 model called
// plain UK paving "stairs" at up to 0.77 on 12 phone frames). Such a class must score at least minScore AND have been seen
// in the previous slow run too (about 2 s apart). prevNames: names that passed minScore last run. Returns
// { dets: what to use now, names: what passed minScore this run (give it back next time) }.
export function confirmSlow(dets, prevNames, rules) {
  const names = new Set();
  const kept = [];
  for (const d of dets) {
    const r = rules[d.name];
    if (!r) { kept.push(d); continue; }
    if ((d.score ?? 1) < r.minScore) continue;
    names.add(d.name);
    if (!r.runs || r.runs < 2 || (prevNames && prevNames.has(d.name))) kept.push(d);
  }
  return { dets: kept, names };
}
