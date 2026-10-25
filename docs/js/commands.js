// Voice command parser (pure, testable). Input is raw recogniser text.
export function parseCommand(raw) {
  if (!raw) return { type: null };
  let t = raw.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(please|thanks|thank you|vision assist|hey|ok|okay)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { type: null };

  // "take me home" / "go home" -> a saved place called home (the app checks saved places before searching)
  if (/\b(?:take me|bring me|get me|go|walk|navigate|head)\s+(?:back\s+)?home\b/.test(t)) return { type: 'navigate', arg: 'home' };

  // Save the place the walker is standing at: "save this place as home", "remember here as the bakery", "this is home"
  const save = t.match(/\b(?:save|remember|mark|bookmark|store)\s+(?:this|here|this place|this spot|this location|my location|where i am)(?:\s+as\s+(.+))?$/)
    || t.match(/\b(?:call this|name this)\s+(.+)$/) || t.match(/^this is\s+(?:my\s+)?(home|work|the office|office)$/);
  if (save) return { type: 'save', arg: (save[1] || '').trim() };
  if (/\b(?:save|remember|mark|bookmark)\s+(?:my\s+)?(home|work)\b/.test(t)) return { type: 'save', arg: t.match(/\b(home|work)\b/)[1] };

  if (/\b(where am i|where are we|my location|what street (?:am i on|is this)|which street (?:am i on|is this))\b/.test(t)) return { type: 'whereami' };

  // What the camera sees, on request ("what is in front of me"). "what is this place" stays with reading (shop signs).
  if (/\b(what(?:'s| is| was)? (?:in front of me|ahead|ahead of me|around me|around|near me|nearby|in front)|what (?:do you|can you) see|describe (?:the |what|my )?(?:scene|view|surroundings|street|area)?|look around|is there anything (?:ahead|in front|near|around)|anything (?:ahead|in front))\b/.test(t)) return { type: 'describe' };

  // Distances in steps or metres
  if (/\b(?:use|switch to|change to|count in|give me|speak in|tell me in)\s+(?:distances?\s+in\s+)?(steps?|paces?)\b|\b(?:distances?|everything)\s+in\s+(steps?|paces?)\b/.test(t)) return { type: 'units', arg: 'steps' };
  if (/\b(?:use|switch to|change to|count in|give me|speak in|tell me in)\s+(?:distances?\s+in\s+)?(metres?|meters?)\b|\b(?:distances?|everything)\s+in\s+(metres?|meters?)\b/.test(t)) return { type: 'units', arg: 'metres' };

  if (/\b(battery|how much (?:charge|power) (?:is )?left|how much charge)\b/.test(t)) return { type: 'battery' };

  const nav = t.match(/\b(?:navigate to|navigate|take me to|directions to|walk to|go to)\s+(.+)$/);
  if (nav && nav[1].trim()) return { type: 'navigate', arg: nav[1].trim() };

  if (/^(read|read this|read that|read it|read the sign|read the text|read aloud|what does (it|that|this) say|what does the sign say|what is written|what shop is this|what is this place|read again)$/.test(t)) return { type: 'read' };

  // Talkativeness. Checked before 'stop' so "be quiet" changes the level instead of stopping the app.
  if (/\bquiet mode\b/.test(t)) return { type: 'level', arg: 'quiet' };
  if (/\bnormal mode\b/.test(t)) return { type: 'level', arg: 'normal' };
  if (/\b(detailed mode|detail mode|full detail)\b/.test(t)) return { type: 'level', arg: 'detailed' };
  if (/\b(less (talk|talking|chat|detail|info)|talk less|quieter|be quiet|fewer alerts|fewer messages)\b/.test(t)) return { type: 'level', arg: 'less' };
  if (/\b(more (detail|talk|alerts|info)|talk more|more messages)\b/.test(t)) return { type: 'level', arg: 'more' };

  if (/\b(cancel navigation|stop navigation|cancel route|cancel)\b/.test(t)) return { type: 'cancel' };
  if (/\b(stop|pause|quit|finish|end session|turn off)\b/.test(t)) return { type: 'stop' };
  if (/\b(repeat|say again|again|what did you say)\b/.test(t)) return { type: 'repeat' };
  if (/\b(help|what can i say|commands)\b/.test(t)) return { type: 'help' };
  if (/\b(start|begin|resume|scan|activate)\b/.test(t)) return { type: 'start' };
  return { type: null, heard: t };
}

export const HELP_TEXT =
  'You can say: start, stop, repeat, or navigate to, followed by a place. ' +
  'Say what is in front of me, where am I, or battery. ' +
  'Say save this place as home, and later, take me home. ' +
  'Say use steps or use metres for distances. ' +
  'Say less talk or more detail to change how much I say. ' +
  'Say help to hear this again.';
