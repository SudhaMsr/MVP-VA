// Google Cloud Text-to-Speech: the app's voice when Google can be reached (8 Nov: "use Google, make Google speech work
// all the time"). Each line is fetched once and kept in memory, so it plays at once the next time. When Google cannot be
// reached (no signal, slow signal, quota) the Speaker uses the phone's own voice for that line, so nothing is ever lost;
// an urgent warning that is not already kept here always uses the phone's voice, because waiting for the network would
// make it late (see speech.js).

export function buildTtsRequest(text, { lang = 'en-GB', voice = 'en-GB-Neural2-C', rate = 0.95 } = {}) {
  return {
    input: { text },
    voice: { languageCode: lang, name: voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
  };
}

export class CloudVoice {
  constructor({ key, lang = 'en-GB', voice = 'en-GB-Neural2-C', fetchFn = (...a) => fetch(...a), log = () => {}, timeoutMs = 3000,
    max = 400, online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false) } = {}) {
    Object.assign(this, { key, lang, voice, fetchFn, log, timeoutMs, max, online });
    this.kept = new Map(); // text|rate -> data: URL, oldest first
    this.inflight = new Map();
    this.refused = false; // the key is not allowed to use Text-to-Speech: a setup problem, so stop asking
  }

  get usable() { return !!this.key && !this.refused && this.online(); }

  _k(text, rate) { return `${rate}|${text}`; }

  // The kept audio for this line, or null.
  cached(text, rate) {
    const k = this._k(text, rate);
    const url = this.kept.get(k);
    if (url == null) return null;
    this.kept.delete(k); this.kept.set(k, url); // most recently used goes to the end
    return url;
  }

  // Fetch (or reuse a fetch already under way). Resolves to a playable URL; rejects when Google cannot be used.
  fetch(text, rate) {
    const k = this._k(text, rate);
    const have = this.kept.get(k);
    if (have) return Promise.resolve(have);
    if (this.inflight.has(k)) return this.inflight.get(k);
    if (!this.usable) return Promise.reject(new Error(this.refused ? 'tts refused' : 'tts offline'));
    const p = this._synth(text, rate).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  async _synth(text, rate) {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.key)}`;
    const body = JSON.stringify(buildTtsRequest(text, { lang: this.lang, voice: this.voice, rate }));
    const once = async () => {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
      try {
        return await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl ? ctl.signal : undefined });
      } finally { clearTimeout(timer); }
    };
    let res;
    try { res = await once(); } catch (e) { this.log('cloud-tts-error', `network ${e && e.name}`); throw e; }
    if (res.status === 401 || res.status === 403) {
      this.refused = true;
      this.log('cloud-tts-refused', String(res.status));
      throw new Error('tts refused');
    }
    if (!res.ok) { this.log('cloud-tts-error', String(res.status)); throw new Error(`tts ${res.status}`); }
    const j = await res.json();
    if (!j || !j.audioContent) throw new Error('tts empty');
    const out = `data:audio/mpeg;base64,${j.audioContent}`;
    this.kept.set(this._k(text, rate), out);
    while (this.kept.size > this.max) this.kept.delete(this.kept.keys().next().value);
    return out;
  }

  // Fetch common lines in the background, one at a time, so they are ready before they are needed.
  async warm(lines, rate) {
    for (const t of lines) {
      if (!this.usable) return;
      try { await this.fetch(t, rate); } catch (_) { /* best effort */ }
    }
  }
}

// Lines worth having ready before the walk: short urgent ones first.
export const WARM_LINES = [
  'Stop.', 'Busy ahead, people close.', 'No clear way. Stop.', 'Clearer on the left.', 'Clearer on the right.',
  'I no longer see anything in your way.', 'Vision Assist is resuming.', 'I did not catch that. Tap the screen and try again.',
  'You are going the right way.', 'Wrong way. Turn around.', 'Turn left now.', 'Turn right now.',
];
