// Google Cloud Speech-to-Text, tap to talk (31 Oct field feedback: "I screamed navigate me to this place and it did not
// listen"; Chrome's always-on recogniser on Android stops every few seconds and misses speech while the phone talks).
// The walker taps, the app goes quiet, records until they stop talking (or 7 s), sends the clip to Google, and hands the
// words back. A failed request is tried once more (a signal blip, a slow reply); Google is never switched off for the rest
// of the walk because of the network, only when the key is refused (8 Nov: "make Google speech work all the time").

// Words and phrases the walker is likely to say: Google weights these higher (better "navigate to", "take me home").
export const PHRASES = [
  'navigate to', 'navigate me to', 'take me to', 'take me home', 'go home', 'cancel navigation', 'stop navigation',
  'where am I', 'what is in front of me', 'what is around me', 'is there a', 'find a', 'how far', "what's next",
  'am I on the right route', 'repeat', 'help', 'stop', 'start', 'battery', 'read', 'less talk', 'more detail',
  'quiet mode', 'normal mode', 'detailed mode', 'speak slower', 'speak faster', 'that was wrong', 'save this place as',
  'save my home address as', 'yes', 'no', 'one', 'two', 'three', 'University of Bristol', 'grocery store', 'bus stop',
  'train station', 'pharmacy', 'supermarket', 'postcode',
];

export function buildRequest(base64Audio, { lang = 'en-GB', sampleRate = 48000, model = 'latest_short', phrases = PHRASES, channels = 1, encoding = 'WEBM_OPUS' } = {}) {
  const config = {
    // channels must match the recording: Google refuses a stereo clip described as mono (seen 6 Nov)
    encoding, sampleRateHertz: sampleRate, audioChannelCount: channels, languageCode: lang, maxAlternatives: 1,
    profanityFilter: false, enableAutomaticPunctuation: false,
    speechContexts: [{ phrases, boost: 12 }],
  };
  if (model) config.model = model;
  return { config, audio: { content: base64Audio } };
}

// How to record (Package I). Chrome records Opus in WebM, which Google takes as it is. Safari on older iPhones can only
// record AAC in MP4, which Google Speech-to-Text does not accept at all, so there the raw microphone samples are kept
// instead and sent as 16 kHz LINEAR16 (plain 16-bit sound, accepted everywhere).
export function pickRecording(isTypeSupported = null) {
  const ok = (m) => { try { return !!(isTypeSupported && isTypeSupported(m)); } catch (_) { return false; } };
  if (ok('audio/webm;codecs=opus')) return { encoding: 'WEBM_OPUS', mime: 'audio/webm;codecs=opus' };
  if (ok('audio/ogg;codecs=opus')) return { encoding: 'OGG_OPUS', mime: 'audio/ogg;codecs=opus' };
  return { encoding: 'LINEAR16', mime: null };
}
export const PCM_RATE = 16000;

// Average down to the target rate (48 kHz to 16 kHz is every 3 samples).
export function downsample(samples, inRate, outRate = PCM_RATE) {
  if (!samples.length || outRate >= inRate) return Float32Array.from(samples);
  const ratio = inRate / outRate; const n = Math.floor(samples.length / ratio); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio); const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += samples[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

// Float samples (-1..1) to 16-bit little-endian bytes.
export function toLinear16(samples) {
  const b = new Uint8Array(samples.length * 2); const v = new DataView(b.buffer);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
  }
  return b;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
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
  // keepMic: Android keeps the microphone open between taps (quicker). iPhone passes false: while Safari holds the
  // microphone, it plays every sound as a phone call (quieter, sometimes from the earpiece) and shows the microphone
  // indicator all walk, so there the microphone is let go as soon as each command is recorded.
  constructor({ key, lang = 'en-GB', log = () => {}, fetchFn = (...a) => fetch(...a), timeoutMs = 6000, retryMs = 400, keepMic = true,
    audioSession = (typeof navigator !== 'undefined' ? navigator.audioSession : null) } = {}) {
    Object.assign(this, { key, lang, log, fetchFn, timeoutMs, retryMs, keepMic, audioSession });
    this.stream = null; this.busy = false; this.refused = false; this.model = 'latest_short';
  }

  get usable() {
    const canRecord = typeof MediaRecorder !== 'undefined' || (typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext));
    return !!(this.key && !this.refused && canRecord && typeof navigator !== 'undefined' && navigator.mediaDevices);
  }

  async _mic() {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    return this.stream;
  }

  // Record one command and return its words ('' = heard nothing). Throws when Google cannot be used.
  async listen({ onSpeechStart = () => {}, onRecorded = () => {} } = {}) {
    if (this.busy) return '';
    this.busy = true;
    // The audio context is made before the first wait, while the tap still counts (Safari keeps it suspended otherwise).
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    let stream = null;
    try {
      if (!this.keepMic) this._session('play-and-record');
      stream = await this._mic();
      if (ctx.state === 'suspended' && ctx.resume) await ctx.resume().catch(() => {});
      const how = pickRecording(typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported ? (m) => MediaRecorder.isTypeSupported(m) : null);
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser();
      an.fftSize = 1024; src.connect(an);
      const parts = []; const pcm = []; let rec = null; let tap = null;
      if (how.mime) {
        rec = new MediaRecorder(stream, { mimeType: how.mime });
        rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      } else {
        // iPhone: keep the raw samples. The processor's output stays silent, so nothing is played back.
        tap = ctx.createScriptProcessor(4096, 1, 1);
        tap.onaudioprocess = (e) => { pcm.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
        src.connect(tap); tap.connect(ctx.destination);
      }
      const buf = new Float32Array(an.fftSize);
      const eos = new EndOfSpeech();
      const t0 = performance.now();
      if (rec) rec.start(250);
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
      if (rec) { const stopped = new Promise((res) => { rec.onstop = res; }); rec.stop(); await stopped; }
      const rate = ctx.sampleRate || 48000;
      try { src.disconnect(); if (tap) { tap.onaudioprocess = null; tap.disconnect(); } } catch (_) { /* ignore */ }
      const track = stream.getAudioTracks()[0];
      const st = (track && track.getSettings && track.getSettings()) || {};
      this._release(); // iPhone: let go of the microphone before the reply is spoken
      this.log('cloud-stt-clip', `${outcome} ${Math.round(performance.now() - t0)} ms ${how.encoding}`);
      if (outcome === 'nothing') return '';
      onRecorded();
      if (!rec) {
        const all = new Float32Array(pcm.reduce((n, p) => n + p.length, 0));
        let o = 0; for (const p of pcm) { all.set(p, o); o += p.length; }
        const b64 = bytesToBase64(toLinear16(downsample(all, rate, PCM_RATE)));
        return await this._recognise(b64, PCM_RATE, 1, 'LINEAR16');
      }
      const b64 = await blobToBase64(new Blob(parts, { type: how.mime }));
      return await this._recognise(b64, rate, st.channelCount || 1, how.encoding);
    } finally {
      try { ctx.close(); } catch (_) { /* ignore */ }
      this._release();
      this.busy = false;
    }
  }

  async _recognise(b64, sampleRate, channels = 1, encoding = 'WEBM_OPUS') {
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(this.key)}`;
    const t0 = performance.now();
    const post = async (opts) => {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
      try {
        return await this.fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(b64, { lang: this.lang, sampleRate, channels, encoding, ...opts })), signal: ctl ? ctl.signal : undefined });
      } finally { clearTimeout(timer); }
    };
    // No reply, a timeout, a Google hiccup (5xx) or too many requests (429): wait a moment and send it once more.
    const send = async (opts) => {
      let res = null;
      try { res = await post(opts); } catch (e) { this.log('cloud-stt-retry', `network ${e && e.name}`); }
      if (res && res.status !== 429 && res.status < 500) return res;
      if (res) this.log('cloud-stt-retry', String(res.status));
      await new Promise((r) => setTimeout(r, this.retryMs));
      return post(opts);
    };
    let res = await send({ model: this.model });
    if (res.status === 400) {
      // Google says what it did not like: the channel count, the sample rate or the model. Fix that one thing and try once more.
      const msg = await res.clone().text().catch(() => '');
      this.log('cloud-stt-400', msg.slice(0, 200));
      const hc = (msg.match(/header[^0-9]*(\d+)/i) || [])[1];
      if (/channel/i.test(msg)) res = await send({ model: this.model, channels: hc ? Number(hc) : (channels === 1 ? 2 : 1) });
      else if (/sample_rate|sample rate/i.test(msg)) res = await send({ model: this.model, sampleRate: encoding === 'LINEAR16' ? PCM_RATE : 48000 });
      else if (this.model) { this.model = null; res = await send({ model: null }); }
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) this.refused = true; // key not allowed for Speech-to-Text: a setup problem
      const body = await res.text().catch(() => '');
      this.log('cloud-stt-error', `${res.status} ${body.slice(0, 200)}`);
      throw new Error(`speech ${res.status}`);
    }
    const text = parseResponse(await res.json());
    this.log('cloud-stt-heard', `${Math.round(performance.now() - t0)} ms "${text}"`);
    return text;
  }

  // iPhone only (keepMic false): stop the microphone and put Safari back to normal playback, so speech is loud again.
  _release() { if (this.keepMic) return; this.close(); this._session('playback'); }

  // Safari 17+ (navigator.audioSession): 'play-and-record' while listening, 'playback' otherwise. Absent elsewhere.
  _session(type) { try { if (this.audioSession && 'type' in this.audioSession) this.audioSession.type = type; } catch (_) { /* not supported */ } }

  // Open the microphone once, inside the Start tap, so the permission question comes then; iPhone lets go of it again.
  async prime() { await this._mic(); this._release(); }

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
