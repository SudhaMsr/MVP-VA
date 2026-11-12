// Privacy and recording consent (Package A, 7 Nov). The walker hears once, on their very first start, what leaves the
// phone; "privacy" repeats it. Recording a session needs a spoken yes, remembered only until the page is closed.
export const PRIVACY_TEXT = 'Your voice and route searches go to Google so I can understand you and find routes. Camera pictures stay on this phone, except one photo sent to Google when you say read or describe this. Recording a session stays on this phone.';
export const RECORD_ASK = 'Recording saves video and a log on this phone. Say yes to start, or no.';
const KEY = 'va.privacySaid';

// The privacy line to speak on this start, or '' when it has been said before. Storage can be missing or throw (private
// browsing, blocked site data): then it is said on every start, which is better than never.
export function firstStartPrivacy(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (storage && storage.getItem(KEY) === '1') return '';
    if (storage) storage.setItem(KEY, '1');
  } catch (_) { /* unavailable: say it anyway */ }
  return PRIVACY_TEXT;
}

// Consent for recording, for this page session only (never stored).
export class RecordingConsent {
  constructor() { this.granted = false; }
  // ask(question, onYes, onNo): how the app asks (the yes/no dialogue). onGranted runs at once if consent was already given.
  request(ask, onGranted, onRefused = () => {}) {
    if (this.granted) { onGranted(); return true; }
    ask(RECORD_ASK, () => { this.granted = true; onGranted(); }, () => onRefused());
    return false;
  }
}
