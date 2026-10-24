// Voice command parser (pure, testable). Input is raw recogniser text.
export function parseCommand(raw) {
  if (!raw) return { type: null };
  let t = raw.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(please|thanks|thank you|vision assist|hey|ok|okay)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { type: null };

  const nav = t.match(/\b(?:navigate to|navigate|take me to|directions to|walk to|go to)\s+(.+)$/);
  if (nav && nav[1].trim()) return { type: 'navigate', arg: nav[1].trim() };

  if (/^(read|read this|read that|read it|read the sign|read the text|read aloud|what does (it|that|this) say|what does the sign say|what is written|what shop is this|what is this place|read again)$/.test(t)) return { type: 'read' };

  if (/\b(cancel navigation|stop navigation|cancel route|cancel)\b/.test(t)) return { type: 'cancel' };
  if (/\b(stop|pause|quit|finish|end session|turn off)\b/.test(t)) return { type: 'stop' };
  if (/\b(repeat|say again|again|what did you say)\b/.test(t)) return { type: 'repeat' };
  if (/\b(help|what can i say|commands)\b/.test(t)) return { type: 'help' };
  if (/\b(start|begin|resume|scan|activate)\b/.test(t)) return { type: 'start' };
  return { type: null, heard: t };
}

export const HELP_TEXT =
  'You can say: start, stop, repeat, or navigate to, followed by a place. ' +
  'Say help to hear this again.';
