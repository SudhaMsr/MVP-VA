// Words the app must never say. A blind walker acts on what they hear: "all clear" or "safe to cross" from an app that
// cannot read a traffic signal, or see a kerb, could put them in the road. tests/safetext.test.js checks every string in
// docs/js against this list, so a new message that implies safety fails the build.
// Allowed on purpose: "Clearer on the left" (a comparison, not a promise) and "No clear way. Stop."
export const BANNED = [
  'safe to cross', 'you can cross', 'all clear', 'path is clear', 'clear path', 'the light is green', 'green light',
  'no obstacles', 'clear ahead', 'looks clear', 'safe to walk', 'safe to go', 'it is safe', "it's safe",
  'you have arrived', // Package G: GPS cannot be that sure; the app says "You should be near your destination"
];

// The shared wording for crossings and traffic signals (Package A, 7 Nov): the app cannot read signals, so it says so.
export const CROSSING_TEXT = "Crossing ahead. I can't read the traffic signal. Listen for traffic before you cross.";
// "What can't you see?"
export const LIMITS_TEXT = "I can't reliably see kerbs, drops, potholes, low branches, ice, or traffic signals. Keep using your cane or guide dog.";

const norm = (t) => String(t ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

// Banned phrases found in text (empty when it is fine to say).
export function bannedIn(text) {
  const t = norm(text);
  return BANNED.filter((b) => t.includes(b));
}

// true when the text says nothing that implies safety.
export function isSafeText(text) { return bannedIn(text).length === 0; }
