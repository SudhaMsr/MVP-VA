// Phone and browser differences (Package I: iPhone Safari). Everything here works on Android Chrome as before; on an
// iPhone it does the extra steps Safari needs. Each function takes the browser objects as arguments so tests can fake them.

// iPhone: the tilt and motion sensors (calibration, floor distance, compass, step counting) send nothing until the page
// asks, and it may only ask from inside a tap. Android: no question is needed.
// Returns 'granted', 'denied', 'not-needed' or 'unavailable'.
export async function requestMotionAccess(win = (typeof window !== 'undefined' ? window : {})) {
  const O = win.DeviceOrientationEvent; const M = win.DeviceMotionEvent;
  if (!O && !M) return 'unavailable';
  const asks = [O, M].filter((E) => E && typeof E.requestPermission === 'function');
  if (!asks.length) return 'not-needed';
  // Both questions are started at once, still inside the tap (Safari forgets the tap after the first await).
  const answers = await Promise.all(asks.map((E) => E.requestPermission().catch(() => 'denied')));
  return answers.every((a) => a === 'granted') ? 'granted' : 'denied';
}

export const MOTION_DENIED_TEXT = 'Motion access is off, so I cannot tell how the phone is tilted or which way you face. '
  + 'To allow it, close the app, open it again, tap Start and choose Allow.';

// iPhone: speech and sound only start if the first one begins inside a tap. Called first thing in the Start tap:
// a silent spoken line unlocks the phone's voice, and a silent clip unlocks the player used for the Google voice.
// A valid 0.05 s silent WAV, built here so it is never a broken file.
export function silentWav(samples = 800, rate = 16000) {
  const b = new Uint8Array(44 + samples * 2); const v = new DataView(b.buffer);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, samples * 2, true);
  return `data:audio/wav;base64,${bytesToBase64(b)}`;
}
export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function unlockAudio({ synth = null, Utterance = null, audio = null } = {}) {
  const done = { speech: false, player: false };
  try {
    if (synth && Utterance) {
      const u = new Utterance(' ');
      u.volume = 0;
      synth.speak(u);
      done.speech = true;
    }
  } catch (_) { /* the phone voice will try again later */ }
  try {
    if (audio && !audio.__unlocked) {
      audio.muted = true;
      audio.src = silentWav();
      const p = audio.play();
      const reset = () => { try { audio.pause(); } catch (_) { /* ignore */ } audio.muted = false; };
      if (p && p.then) p.then(reset, reset); else reset();
      audio.__unlocked = true;
      done.player = true;
    }
  } catch (_) { /* the Google voice falls back to the phone's voice */ }
  return done;
}

// The screen must stay on: when it locks, the browser stops the camera and the app stops itself.
export const NO_WAKE_LOCK_TEXT = 'I cannot keep the screen on, so the phone may lock it. When the screen locks, I stop. '
  + 'Set the phone to lock the screen less often, or tap the screen now and then.';

// Says the line above once per page, when the screen lock request is not available or is refused.
export class WakeNotice {
  constructor(say) { this.say = say; this.said = false; }
  report(ok) {
    if (ok || this.said) return false;
    this.said = true;
    this.say(NO_WAKE_LOCK_TEXT, 'status');
    return true;
  }
}
