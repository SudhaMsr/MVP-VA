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
