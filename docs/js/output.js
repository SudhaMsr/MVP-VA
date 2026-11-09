// Where each message goes (Package D): speech, the screen reader, vibration.
// Output modes: 'both' (speech and vibration, the default), 'vibration' (vibration only: hazard alerts buzz instead of
// being spoken, but vehicle warnings are always spoken too), 'speech' (speech only: no vibration).
// Screen reader mode (TalkBack users): status lines (answers, questions, notices) go to an aria-live region so TalkBack
// reads them in its own voice and queue; hazard alerts, vehicle warnings and turn prompts are still spoken by the app,
// because they must never wait behind TalkBack.
export const OUTPUT_MODES = ['both', 'vibration', 'speech'];
export const OUTPUT_NAMES = { both: 'speech and vibration', vibration: 'vibration only', speech: 'speech only' };

// The mode the app really uses. A phone or browser that cannot vibrate (every iPhone browser) can never be in vibration
// only: hazard alerts would be neither spoken nor felt. It falls back to speech and vibration (so warnings are spoken).
export function effectiveMode(mode, canVibrate = true) {
  if (!OUTPUT_MODES.includes(mode)) return 'both';
  return mode === 'vibration' && !canVibrate ? 'both' : mode;
}
export const NO_VIBRATE_TEXT = 'This phone cannot vibrate, so I will keep speaking warnings.';

// kind: 'urgent' (vehicles), 'normal' (hazard alerts), 'nav' (turn prompts), 'status' (everything else).
// canVibrate: false on a phone that cannot vibrate; then nothing is ever left to vibration alone.
export function routeOutput(kind, { mode = 'both', screenReader = false, canVibrate = true } = {}) {
  mode = effectiveMode(mode, canVibrate);
  const vibrate = mode !== 'speech' && canVibrate;
  if (kind === 'urgent') return { speak: true, live: false, vibrate };
  if (kind === 'normal') return { speak: mode !== 'vibration', live: false, vibrate };
  if (kind === 'nav') return { speak: true, live: false, vibrate };
  return { speak: !screenReader, live: !!screenReader, vibrate: false };
}

export function outputText(mode) {
  if (mode === 'vibration') return 'Vibration only. I will buzz for things in your way, and still speak vehicle warnings and directions.';
  if (mode === 'speech') return 'Speech only. No vibration.';
  return 'Speech and vibration.';
}
