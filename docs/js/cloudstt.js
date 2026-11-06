// Google Cloud Speech-to-Text, tap to talk (31 Oct field feedback: "I screamed navigate me to this place and it did not
// listen"; Chrome's always-on recogniser on Android stops every few seconds and misses speech while the phone talks).
// The walker taps, the app goes quiet, records until they stop talking (or 7 s), sends the clip to Google, and hands the
// words back. If Google fails (no internet, key not allowed), the caller falls back to Chrome's recogniser.

// Words and phrases the walker is likely to say: Google weights these higher (better "navigate to", "take me home").
export const PHRASES = [
  'navigate to', 'navigate me to', 'take me to', 'take me home', 'go home', 'cancel navigation', 'stop navigation',
  'where am I', 'what is in front of me', 'what is around me', 'is there a', 'find a', 'how far', "what's next",
  'am I on the right route', 'repeat', 'help', 'stop', 'start', 'battery', 'read', 'less talk', 'more detail',
  'quiet mode', 'normal mode', 'detailed mode', 'speak slower', 'speak faster', 'that was wrong', 'save this place as',
  'save my home address as', 'yes', 'no', 'one', 'two', 'three', 'University of Bristol', 'grocery store', 'bus stop',
  'train station', 'pharmacy', 'supermarket', 'postcode',
];

export function buildRequest(base64Audio, { lang = 'en-GB', sampleRate = 48000, model = 'latest_short', phrases = PHRASES, channels = 1 } = {}) {
  const config = {
    // channels must match the recording: Google refuses a stereo clip described as mono (seen 6 Nov)
    encoding: 'WEBM_OPUS', sampleRateHertz: sampleRate, audioChannelCount: channels, languageCode: lang, maxAlternatives: 1,
    profanityFilter: false, enableAutomaticPunctuation: false,
    speechContexts: [{ phrases, boost: 12 }],
  };
  if (model) config.model = model;
  return { config, audio: { content: base64Audio } };
}

// The words Google heard, or '' when it heard nothing.
export function parseResponse(json) {
  if (!json || !Array.isArray(json.results)) return '';
  return json.results.map((r) => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '').join(' ').replace(/\s+/g, ' ').trim();
}

// Silence detection on a level stream (pure, for tests): speech starts when the level passes `on`; the clip ends after
// `silenceMs` below `off` once speech has started, or at `maxMs`; it gives up at `waitMs` if nobody spoke.
export class EndOfSpeech {
  constructor({ on = 0.045, off = 0.025, silenceMs = 900, maxMs = 7000, waitMs = 5000 } = {}) {
    Object.assign(this, { on, off, silenceMs, maxMs, waitMs });
    this.t0 = null; this.spoke = false; this.quietSince = null;
  }
  // level: 0..1 (RMS of the microphone), t: ms. Returns 'listening', 'done' (speech then silence, or too long) or 'nothing'.
  step(level, t) {
    if (this.t0 == null) this.t0 = t;
    if (level >= this.on) { this.spoke = true; this.quietSince = null; }
    else if (this.spoke && level < this.off) { if (this.quietSince == null) this.quietSince = t; }
    if (this.spoke && this.quietSince != null && t - this.quietSince >= this.silenceMs) return 'done';
    if (t - this.t0 >= this.maxMs) return this.spoke ? 'done' : 'nothing';
    if (!this.spoke && t - this.t0 >= this.waitMs) return 'nothing';
    return 'listening';
  }
}

export class CloudListener {
  constructor({ key, lang = 'en-GB', log = () => {}, fetchFn = (...a) => fetch(...a) } = {}) {
    Object.assign(this, { key, lang, log, fetchFn });
    this.stream = null; this.busy = false; this.failed = 0; this.model = 'latest_short';
  }

  get usable() { return !!(this.key && typeof MediaRecorder !== 'undefined' && navigator.mediaDevices && this.failed < 2); }

  async _mic() {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return this.stream;
  }

  // Record one command and return its words ('' = heard nothing). Throws when Google cannot be used.
  async listen({ onSpeechStart = () => {}, onRecorded = () => {} } = {}) {
    if (this.busy) return '';
    this.busy = true;
    try {
      const stream = await this._mic();
      const mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const eos = new EndOfSpeech();
      const t0 = performance.now();
      rec.start(250);
      const outcome = await new Promise((resolve) => {
        let started = false;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          const r = eos.step(Math.sqrt(s / buf.length), performance.now());
          if (!started && eos.spoke) { started = true; onSpeechStart(); }
          if (r === 'listening') setTimeout(tick, 50); else resolve(r);
        };
        tick();
      });
      const stopped = new Promise((res) => { rec.onstop = res; });
      rec.stop(); await stopped;
      try { src.disconnect(); ctx.close(); } catch (_) { /* ignore */ }
      this.log('cloud-stt-clip', `${outcome} ${Math.round(performance.now() - t0)} ms`);
      if (outcome === 'nothing') return '';
      onRecorded();
      const blob = new Blob(parts, { type: mime });
      const b64 = await blobToBase64(blob);
      const st = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].getSettings && stream.getAudioTracks()[0].getSettings()) || {};
      const text = await this._recognise(b64, ctx.sampleRate || 48000, st.channelCount || 1);
      this.failed = 0;
      return text;
    } finally {
      this.busy = false;
    }
  }

  async _recognise(b64, sampleRate, channels = 1) {
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(this.key)}`;
    const t0 = performance.now();
    const send = (opts) => this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(b64, { lang: this.lang, sampleRate, channels, ...opts })) });
    let res = await send({ model: this.model });
    if (res.status === 400) {
      // Google says what it did not like: the channel count, the sample rate or the model. Fix that one thing and try once more.
      const msg = await res.clone().text().catch(() => '');
      this.log('cloud-stt-400', msg.slice(0, 200));
      const hc = (msg.match(/header[^0-9]*(\d+)/i) || [])[1];
      if (/channel/i.test(msg)) res = await send({ model: this.model, channels: hc ? Number(hc) : (channels === 1 ? 2 : 1) });
      else if (/sample_rate|sample rate/i.test(msg)) res = await send({ model: this.model, sampleRate: 48000 });
      else if (this.model) { this.model = null; res = await send({ model: null }); }
    }
    if (!res.ok) {
      this.failed += res.status === 401 || res.status === 403 ? 99 : 1; // key not allowed for Speech-to-Text: stop trying
      const body = await res.text().catch(() => '');
      this.log('cloud-stt-error', `${res.status} ${body.slice(0, 200)}`);
      throw new Error(`speech ${res.status}`);
    }
    const text = parseResponse(await res.json());
    this.log('cloud-stt-heard', `${Math.round(performance.now() - t0)} ms "${text}"`);
    return text;
  }

  close() { try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ } this.stream = null; }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
