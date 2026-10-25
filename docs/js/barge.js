// Deciding whether the microphone heard the walker, or only the app's own voice.
// Chrome gives no echo cancellation for the app's speech, so this is done by the words:
//  - echo: everything heard is something the app has just said
//  - barge-in: the walker is talking over the app (words the app did not say, or a clear command or answer)
const FILLER = new Set(['a', 'an', 'the', 'um', 'uh', 'er', 'and', 'to', 'of', 'is', 'it']);
export const wordsOf = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// recent: the texts the app spoke most recently (lower case), newest last.
export function looksLikeEcho(text, recent) {
  const w = wordsOf(text);
  if (!w.length) return true;
  return recent.slice(-3).some((h) => w.every((x) => h.includes(x)));
}

// text: what the recogniser has heard so far (may be unfinished).
// isCommand / isAnswer: true when the words are a voice command, or an answer to a question the app is waiting on.
export function isBargeIn(text, recent, { isCommand = false, isAnswer = false } = {}) {
  if (isAnswer || isCommand) return true;
  const spoken = new Set(recent.slice(-4).flatMap((h) => wordsOf(h)));
  const fresh = wordsOf(text).filter((x) => !FILLER.has(x) && !spoken.has(x));
  return fresh.length >= 2; // one odd word is usually the recogniser mishearing the app's own voice
}
