// Voice command parser (pure, testable). Input is raw recogniser text.
export function parseCommand(raw) {
  if (!raw) return { type: null };
  const lower = raw.toLowerCase();
  let t = lower.replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(please|thanks|thank you|vision assist|hey|ok|okay)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { type: null };

  // How long the walker's step is, for distances in steps: "my step is 60 centimetres", "set my step length to 2 feet",
  // "my steps are shorter". Decimals are kept (0.65 metres), so this reads the text before punctuation is stripped.
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
  const UNIT = { cm: 0.01, centimetre: 0.01, centimetres: 0.01, centimeter: 0.01, centimeters: 0.01, cms: 0.01, inch: 0.0254, inches: 0.0254,
    foot: 0.3048, feet: 0.3048, ft: 0.3048, metre: 1, metres: 1, meter: 1, meters: 1, yard: 0.9144, yards: 0.9144 };
  const len = lower.match(/\b(?:step|steps|stride|pace)(?: length| size)?(?: is| are| to| at)?\s+(?:about |around )?(\d+(?:\.\d+)?|one|two|three|four|five|half)\s*(centimet(?:re|er)s?|cms?|inch(?:es)?|feet|foot|ft|metres?|meters?|yards?)\b/);
  if (len) return { type: 'stepLength', arg: Math.round((WORD[len[1]] ?? parseFloat(len[1])) * UNIT[len[2]] * 10000) / 10000 };
  const rel = t.match(/\b(?:step|steps|stride|pace)(?: length| size)?(?: is| are| should be)?\s*(shorter|longer|smaller|bigger)\b/);
  if (rel) return { type: 'stepLength', arg: /shorter|smaller/.test(rel[1]) ? 'shorter' : 'longer' };

  // "take me home" / "go home" -> a saved place called home (the app checks saved places before searching)
  if (/\b(?:take me|bring me|get me|go|walk|navigate|head)\s+(?:back\s+)?home\b/.test(t)) return { type: 'navigate', arg: 'home' };

  // Save an address (typed or spoken) as a named place: "save my home address as 25 Lakeside BS16 3EE".
  const addr = t.match(/\b(?:save|set|store|remember|update|change)\s+(?:my\s+)?(?:(home|work|office)(?:\s+address)?|([a-z]+(?:\s[a-z]+)?)\s+address)\s*(?:as|to|is)\s+(.+)$/)
    || t.match(/\bmy\s+(home|work|office)\s+address\s+is\s+(.+)$/);
  if (addr) {
    const name = addr.length === 3 ? addr[1] : (addr[1] || addr[2]);
    const arg = (addr.length === 3 ? addr[2] : addr[3]).trim();
    if (arg) return { type: 'saveAddress', name, arg };
  }

  // Save the place the walker is standing at: "save this place as home", "remember here as the bakery", "this is home"
  const save = t.match(/\b(?:save|remember|mark|bookmark|store)\s+(?:this|here|this place|this spot|this location|my location|where i am)(?:\s+as\s+(.+))?$/)
    || t.match(/\b(?:call this|name this)\s+(.+)$/) || t.match(/^this is\s+(?:my\s+)?(home|work|the office|office)$/);
  if (save) return { type: 'save', arg: (save[1] || '').trim() };
  if (/\b(?:save|remember|mark|bookmark)\s+(?:my\s+)?(home|work)$/.test(t)) return { type: 'save', arg: t.match(/(home|work)$/)[1] }; // only when nothing follows: "save my home" = here

  // Speech speed
  if (/\b(slow down|slower|more slowly|speak slower|talk slower|too fast)\b/.test(t)) return { type: 'rate', arg: 'slower' };
  if (/\b(speed up|faster|more quickly|quicker|speak faster|talk faster|too slow)\b/.test(t)) return { type: 'rate', arg: 'faster' };

  // Safety: send where I am to someone, and "I am lost"
  if (/\b(?:share|send|text)\s+(?:my\s+)?(?:location|position|where i am)\b/.test(t)) return { type: 'share' };
  if (/\b(?:i am|i'm|im|we are|we're)\s+lost\b|\bhelp me i am lost\b/.test(t)) return { type: 'lost' };

  if (/\b(where am i|where are we|my location|what street (?:am i on|is this)|which street (?:am i on|is this))\b/.test(t)) return { type: 'whereami' };

  // What the camera sees, on request ("what is in front of me"). "what is this place" stays with reading (shop signs).
  if (/\b(what(?:'s| is| was)? (?:in front of me|ahead|ahead of me|around me|around|near me|nearby|in front)|what (?:do you|can you) see|describe (?:the |what|my )?(?:scene|view|surroundings|street|area)?|look around|is there anything (?:ahead|in front|near|around)|anything (?:ahead|in front))\b/.test(t)) return { type: 'describe' };

  // Distances in miles (yards for short ones), steps or metres
  if (/\b(?:use|switch to|change to|count in|give me|speak in|tell me in|set)\s+(?:distances?\s+(?:in|to)\s+)?(miles?|yards?|imperial)\b|\b(?:distances?|everything)\s+in\s+(miles?|yards?)\b/.test(t)) return { type: 'units', arg: 'miles' };
  if (/\b(?:use|switch to|change to|count in|give me|speak in|tell me in|set)\s+(?:distances?\s+(?:in|to)\s+)?(steps?|paces?)\b|\b(?:distances?|everything)\s+in\s+(steps?|paces?)\b/.test(t)) return { type: 'units', arg: 'steps' };
  if (/\b(?:use|switch to|change to|count in|give me|speak in|tell me in|set)\s+(?:distances?\s+(?:in|to)\s+)?(metres?|meters?)\b|\b(?:distances?|everything)\s+in\s+(metres?|meters?)\b/.test(t)) return { type: 'units', arg: 'metres' };

  if (/\b(battery|how much (?:charge|power) (?:is )?left|how much charge)\b/.test(t)) return { type: 'battery' };

  // "navigate to X", "navigate me to X", "can you take me to X", "guide me to X", "how do I get to X", "I want to go to X"
  const nav = t.match(/\b(?:(?:navigate|take|guide|bring|lead|direct|walk|get|show|send)\s+me\s+(?:to|towards)|navigate to|navigate|directions? to|(?:find |get )?(?:me )?(?:a |the )?(?:walking )?route to|how (?:do|can) i get to|(?:i )?(?:want|need|would like|wanna) to (?:go|get|walk) to|walk to|go to)\s+(.+)$/);
  if (nav && nav[1].trim()) {
    const arg = nav[1].replace(/\s+(?:now|from here|from my location)$/, '').trim();
    // The recogniser often cuts the sentence after "navigate me" or "navigate me to": there is no place yet, so ask for one.
    const empty = arg.replace(/\b(?:me|to|too|two|the|a|an|please|this|that|place|somewhere|there|my|i|ok|okay)\b/g, ' ').replace(/\s+/g, '').length < 2;
    return empty ? { type: 'navigateAsk' } : { type: 'navigate', arg };
  }
  if (/^(?:navigate|take me|guide me|directions|navigation)(?: me)?(?: to)?$/.test(t)) return { type: 'navigateAsk' };

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
  'Say use miles, use metres or use steps for distances, and my step is, with a length, to set your step. ' +
  'Say save my home address as, and the address, to set home from an address. ' +
  'Say slower or faster to change how fast I speak. Say share my location to send where you are to someone. If you are lost, say I am lost. ' +
  'Say less talk or more detail to change how much I say. ' +
  'Say help to hear this again.';
