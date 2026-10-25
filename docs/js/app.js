// Vision Assist - app wiring: camera, detection loop, speech, voice commands, error handling.
// Rule for this file: every failure is spoken. No silent states.
import { CONFIG, MODELS, DEFAULT_MODEL, SECONDARY, GOOGLE_KEY, FEATURES } from './config.js';
import { filterAllowed, mergeLanes } from './lanes.js';
import { Detector } from './detector.js';
import { Tracker } from './tracker.js';
import { AlertEngine, LEVELS } from './alerts.js';
import { Cues } from './cues.js';
import { getUnits, setUnits, getStep, setStep, stepCm, UNIT_MODES } from './units.js';
import { describeScene, NO_CAMERA } from './describe.js';
import { reverseLookup, describePlace, PlaceStore, normaliseName } from './places.js';
import { BatteryWatch } from './battery.js';
import { Speaker } from './speech.js';
import { parseCommand, HELP_TEXT } from './commands.js';
import { Navigator, makeProviders, locationMessage } from './nav.js';
import { Dialogue } from './dialogue.js';
import { recogniseText, readingSpeech } from './reader.js';

const params = new URLSearchParams(location.search);
const SIZE = params.get('size') === '416' ? 416 : CONFIG.inputSize;
const MODEL_KEY = MODELS[params.get('model')] ? params.get('model') : DEFAULT_MODEL;
const MODEL = MODELS[MODEL_KEY];
let DEBUG = params.has('debug'); // supervisor: show the camera view and boxes. ?debug still works, but there is a switch in More options
let RECORD = params.has('record'); // supervisor: record raw video + per-frame detections for review (switch in More options too)
const EP = params.get('ep') || 'wasm';

const $ = (id) => document.getElementById(id);
const el = {
  start: $('startBtn'), stop: $('stopBtn'), repeat: $('repeatBtn'), mic: $('micBtn'),
  status: $('status'), last: $('lastAlert'), stats: $('stats'), video: $('video'), overlay: $('overlay'),
  dl: $('logBtn'), saveRec: $('saveRecBtn'), level: $('levelBtn'), tap: $('tapBtn'), units: $('unitsBtn'), step: $('stepBtn'), dbg: $('debugBtn'), rec: $('recordBtn'),
};

const FULL_DISCLAIMER =
  'Vision Assist can miss obstacles and can be wrong. ' +
  'Always use your cane or guide dog as well. Starting now.';

const speaker = new Speaker(window.speechSynthesis, window.SpeechSynthesisUtterance, {
  rate: CONFIG.speechRate, lang: CONFIG.speechLang, staleMs: CONFIG.staleMs,
});
const tracker = new Tracker();
const engine = new AlertEngine(CONFIG, CONFIG.verbosity);
const cues = new Cues();
const places = new PlaceStore();
let detector = null;
let slowDetector = null; // second model for stairs, manholes, benches...
const slow = { dets: [], t: null, ranAt: 0 };
let frameCount = 0;
const USE_SLOW = params.get('lane') !== 'off' && MODEL_KEY !== SECONDARY.model;
let stream = null;
let recognition = null;
let wakeLock = null;

const state = {
  running: false, starting: false, listening: false, firstRun: true, wasRunning: false,
  lastSpoken: '', lastSpeechAt: performance.now(), lastFrameOk: 0, errors: 0, timer: null,
  lastWarnAt: 0, talkUntil: 0, talkHeard: false, tapToTalk: true, lastTapAt: 0,
};
let talkTimer = null;
const frameTimes = [];
const frameLog = []; // per-frame detections, only filled when recording
let recorder = null;
let recChunks = [];
let recBlob = null;
let recMime = '';
const spokenHistory = []; // for ignoring our own voice picked up by the microphone
const session = { startedAt: new Date().toISOString(), events: [], size: SIZE, ep: EP, model: MODEL_KEY };

speaker.onSpoken = (item) => {
  state.lastSpeechAt = performance.now();
  state.lastSpoken = item.kind === 'status' ? state.lastSpoken : item.text;
  spokenHistory.push({ text: item.text.toLowerCase(), t: performance.now() });
  if (spokenHistory.length > 6) spokenHistory.shift();
  el.last.textContent = item.text;
  session.events.push({ t: Date.now(), kind: item.kind, text: item.text });
};

function say(text, kind = 'status') {
  if (!speaker.supported) setStatus('Speech is not available on this phone. Alerts will only show on screen.');
  speaker.speak(text, kind);
}

let lastTraceAt = 0;
const navigator_ = new Navigator({
  say: (t, k) => say(t, k),
  trace: (f) => { const n = Date.now(); if (n - lastTraceAt < 3000) return; lastTraceAt = n; logEvent('fix', JSON.stringify(f)); },
  providers: makeProviders({
    googleKey: new URLSearchParams(location.search).get('maps') === 'osm' ? '' : GOOGLE_KEY,
    onFallback: (what, e) => session.events.push({ t: Date.now(), kind: 'nav-fallback', text: `${what}: ${e && e.message}` }),
  }),
  // The first fix Chrome gives is often a rough network guess (it can be streets out). So wait up to 10 seconds for a
  // proper GPS fix (25 m or better) and use the best one seen.
  getPosition: () => new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('no geolocation'));
    const wait = setTimeout(() => say('Waiting for your location. If your phone asks, allow location.', 'status'), 4000);
    let best = null, lastErr = null, ids = [], done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(wait); clearTimeout(limit);
      for (const i of ids) { try { navigator.geolocation.clearWatch(i); } catch (_) { /* ignore */ } }
      best ? res(best) : rej(lastErr || new Error('no location'));
    };
    const limit = setTimeout(finish, 10000);
    const onFix = (p) => {
      const f = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
      if (!best || f.accuracy < best.accuracy) best = f;
      if (best.accuracy <= 25) finish();
    };
    let failed = 0;
    const onErr = (e) => { lastErr = lastErr && lastErr.code === 1 ? lastErr : e; if ((e && e.code === 1) || ++failed >= 2) finish(); };
    // Two requests at once: precise GPS (phones) and the ordinary kind (laptops have no GPS, only Wi-Fi/network location).
    ids.push(navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
    ids.push(navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 }));
  }),
  watch: (ok, err) => navigator.geolocation.watchPosition(
    (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }), err,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }),
  unwatch: (id) => navigator.geolocation.clearWatch(id),
});
window.__nav = navigator_;
const answerRow = document.getElementById('answerRow');
const dialogue = new Dialogue({
  say: (t, k) => say(t, k),
  nav: navigator_,
  places,
  onPrompt: (options) => {
    answerRow.textContent = '';
    answerRow.hidden = !options;
    for (const o of options || []) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = o.label;
      b.addEventListener('click', () => dialogue.answer(o.value));
      answerRow.appendChild(b);
    }
  },
});
window.__dialogue = dialogue;
document.getElementById('navForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('navInput').value.trim();
  if (!q) { say('Type or say where you want to go.', 'status'); return; }
  const typed = parseCommand(q);
  if (typed.type === 'saveAddress') { dialogue.saveAddress(typed.name, typed.arg); return; }
  const saved = places.get(q);
  if (saved) dialogue.navigateToSaved(saved); else navigator_.start(q);
});
document.getElementById('navCancel').addEventListener('click', () => {
  if (!navigator_.cancel()) say('No navigation is active.', 'status');
});

const READ_ON = FEATURES.read || new URLSearchParams(location.search).get('read') === '1';
let reading = false;
async function readText() {
  if (reading || !READ_ON) return;
  if (!stream || !el.video.videoWidth) { say('Tap start first, so the camera is on. Then say read.', 'status'); return; }
  reading = true;
  try {
    say('Reading.', 'status');
    const v = el.video, scale = Math.min(1, 1000 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const t0 = performance.now();
    const parsed = await recogniseText(c, { onLoading: () => say('Getting the reading tool ready. This takes a few seconds the first time.', 'status') });
    const text = readingSpeech(parsed);
    session.events.push({ t: Date.now(), kind: 'read', text, pieces: parsed.pieces, confidence: parsed.confidence, engine: parsed.engine, ms: Math.round(performance.now() - t0) });
    say(text, 'status');
    state.lastSpoken = text;
  } catch (e) {
    session.events.push({ t: Date.now(), kind: 'read-error', text: String(e && e.message) });
    say('I could not read that. The reading tool needs internet the first time. Try again.', 'status');
  } finally { reading = false; }
}
document.getElementById('readBtn').hidden = !READ_ON;
document.getElementById('readBtn').addEventListener('click', () => readText());

if (!speaker.supported) document.getElementById('status').setAttribute('aria-live', 'polite'); // no voice: let the screen reader announce

function setStatus(text) {
  el.status.textContent = text;
}

function logEvent(type, detail) {
  session.events.push({ t: Date.now(), type, detail: String(detail) });
  if (session.events.length > 2000) session.events.shift();
}

// ---------- camera ----------
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('no mediaDevices'); e.name = 'NotSupportedError'; throw e;
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  el.video.srcObject = stream;
  await el.video.play();
  if (!el.video.videoWidth) {
    await new Promise((res) => el.video.addEventListener('loadedmetadata', res, { once: true }));
  }
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (state.running) {
      say('The camera stopped. Another app may be using it. Tap start to try again.', 'urgent');
      stopInternal();
    }
  });
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  el.video.srcObject = null;
}

function cameraErrorText(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Open Chrome site settings, allow the camera for this page, then tap start.';
    case 'NotFoundError':
      return 'No camera was found on this phone.';
    case 'NotReadableError':
      return 'The camera is busy. Close other camera apps, then tap start.';
    case 'NotSupportedError':
      return 'This browser cannot use the camera. Open this page in Chrome over a secure connection.';
    default:
      return 'The camera could not be started. Tap start to try again.';
  }
}

// ---------- model ----------
async function loadModel() {
  if (detector && detector.session) return;
  if (!window.ort) throw new Error('onnxruntime-web did not load');
  window.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
  const d = new Detector(window.ort, SIZE, MODEL.names);
  const t0 = performance.now();
  await d.load(MODEL.url(SIZE), [EP]);
  session.modelLoadMs = Math.round(performance.now() - t0);
  detector = d;
  if (USE_SLOW && !slowDetector) {
    try {
      const sm = MODELS[SECONDARY.model];
      const sd = new Detector(window.ort, SECONDARY.size, sm.names);
      await sd.load(sm.url(SECONDARY.size), [EP]);
      slowDetector = sd;
    } catch (e) {
      logEvent('slow-model-error', e && e.message);
      say('Stairs and manhole detection could not load. Other detection is working.', 'status');
    }
  }
}

// ---------- main loop ----------
async function loop() {
  if (!state.running) return;
  const t0 = performance.now();
  try {
    const { dets: fast, width, height } = await detector.detect(el.video, CONFIG.confThreshold, CONFIG.nmsIou);
    if (!state.running) return; // stopped while this frame was in flight
    frameCount += 1;
    if (slowDetector && performance.now() - slow.ranAt >= SECONDARY.everyMs) {
      slow.ranAt = performance.now();
      try {
        const r = await slowDetector.detect(el.video, SECONDARY.conf, CONFIG.nmsIou);
        slow.dets = filterAllowed(r.dets, SECONDARY.classes);
        slow.t = performance.now();
      } catch (e) { logEvent('slow-frame-error', e && e.message); }
      if (!state.running) return;
    }
    const t = performance.now();
    const dets = mergeLanes(fast, slow, t, SECONDARY.maxAgeMs);
    const tracks = tracker.update(dets, t, width, height);
    state.scene = { tracks, w: width, h: height, t };
    const alert = engine.next(tracks, width, height, t);
    if (alert && (alert.urgent || performance.now() > state.talkUntil)) { // routine alerts wait while the walker is speaking
      if (alert.urgent) cues.play('urgent');
      speaker.speak(alert.text, alert.urgent ? 'urgent' : 'normal');
      logEvent('alert', `${alert.priority}|${alert.text}`);
    }
    if (DEBUG) drawOverlay(tracks, width, height);
    const ms = performance.now() - t0;
    frameTimes.push(ms);
    if (RECORD) logFrame(tracks, ms);
    if (frameTimes.length > 40) frameTimes.shift();
    state.lastFrameOk = t;
    state.errors = 0;
    updateStats();
  } catch (e) {
    state.errors += 1;
    logEvent('frame-error', e && e.message);
    if (state.errors === 3) say('Detection problem. Retrying.', 'status');
    if (state.errors >= 10) {
      say('Detection stopped after repeated errors. Tap start to try again.', 'urgent');
      stopInternal();
      return;
    }
  }
  const gap = Math.max(0, CONFIG.minFrameGapMs - (performance.now() - t0));
  state.timer = setTimeout(loop, gap);
}

function updateStats() {
  const a = frameTimes.slice().sort((x, y) => x - y);
  if (!a.length) return;
  const med = a[Math.floor(a.length / 2)];
  const p95 = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
  el.stats.textContent =
    `Speed check: median ${med.toFixed(0)} ms, 95% under ${p95.toFixed(0)} ms ` +
    `(${(1000 / med).toFixed(1)} frames/s). Model ${MODEL_KEY} ${SIZE}px${slowDetector ? ' + stairs lane' : ''}, ${EP}, ` +
    `${window.ort ? window.ort.env.wasm.numThreads : '?'} thread(s)${self.crossOriginIsolated ? ', isolated' : ''}.`;
}

function drawOverlay(tracks, w, h) {
  const c = el.overlay;
  if (c.width !== w) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3; g.font = '20px sans-serif';
  for (const tr of tracks) {
    g.strokeStyle = '#ffd400'; g.fillStyle = '#ffd400';
    g.strokeRect(tr.box.x1, tr.box.y1, tr.box.x2 - tr.box.x1, tr.box.y2 - tr.box.y1);
    const d = tr.dist != null ? ` ${tr.dist.toFixed(1)}m` : '';
    g.fillText(`${tr.name}${d}`, tr.box.x1 + 4, Math.max(20, tr.box.y1 + 20));
  }
}

// ---------- recording (supervisor option: ?record) ----------
function logFrame(tracks, ms) {
  frameLog.push({
    t: Date.now(), ms: Math.round(ms),
    d: tracks.map((tr) => [tr.name, Math.round(tr.box.x1), Math.round(tr.box.y1), Math.round(tr.box.x2),
      Math.round(tr.box.y2), +tr.score.toFixed(2), tr.dist == null ? null : +tr.dist.toFixed(1)]),
  });
  if (frameLog.length > 20000) frameLog.shift();
}

function startRecording() {
  if (!RECORD || !stream) return;
  if (typeof MediaRecorder === 'undefined') {
    logEvent('record-unsupported', '');
    say('Recording is not supported in this browser.', 'status');
    return;
  }
  recChunks = [];
  recBlob = null;
  frameLog.length = 0;
  el.saveRec.disabled = true;
  el.saveRec.textContent = 'Recording...';
  const mimes = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
  recMime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  try {
    recorder = new MediaRecorder(stream, recMime ? { mimeType: recMime, videoBitsPerSecond: 1500000 } : {});
  } catch (e) {
    logEvent('record-error', e && e.message);
    say('Recording could not start.', 'status');
    return;
  }
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstart = () => { session.recStartedAt = Date.now(); session.recMime = recorder.mimeType; };
  recorder.onstop = () => {
    recBlob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
    el.saveRec.disabled = recBlob.size === 0;
    el.saveRec.textContent = `Save recording (${(recBlob.size / 1048576).toFixed(1)} MB)`;
  };
  recorder.start(1000);
}

function stopRecording() {
  try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* ignore */ }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sessionBlob() {
  return new Blob([JSON.stringify({ ...session, frameMs: frameTimes, speech: speaker.log, frames: frameLog }, null, 2)],
    { type: 'application/json' });
}

// ---------- health checks ----------
setInterval(() => {
  navigator_.tick(); // speaks if location updates stop, even when the camera side is not running
  if (!state.running) return;
  const now = performance.now();
  if (now - state.lastFrameOk > 5000 && now - state.lastWarnAt > 10000) {
    state.lastWarnAt = now;
    say('Detection has paused. Retrying.', 'status');
  } else if (now - state.lastSpeechAt > CONFIG.heartbeatMs) {
    say('Still scanning, nothing recognised.', 'normal');
  }
}, 1000);

// ---------- start / stop ----------
async function start() {
  if (state.running || state.starting) return;
  state.starting = true;
  cues.unlock();
  startBatteryWatch();
  updateMain();
  setStatus('Starting');
  say(state.firstRun ? FULL_DISCLAIMER : 'Starting.', 'status');
  startListening(); // inside the tap, so the browser allows the microphone prompt
  try { navigator.geolocation.getCurrentPosition(() => {}, () => {}, { maximumAge: 60000, timeout: 10000 }); } catch (_) { /* ask for location now, so the prompt is not a surprise mid-walk */ }
  try {
    await openCamera();
  } catch (e) {
    logEvent('camera-error', e && e.name);
    say(cameraErrorText(e), 'status');
    setStatus('Camera problem. Tap start to retry.');
    state.starting = false;
    updateMain();
    return;
  }
  try {
    await loadModel();
  } catch (e) {
    logEvent('model-error', e && e.message);
    say('The detection model could not load. Check your internet connection, then tap start.', 'status');
    setStatus('Model problem. Tap start to retry.');
    stopCamera();
    state.starting = false;
    updateMain();
    return;
  }
  state.firstRun = false;
  state.running = true;
  state.starting = false;
  state.errors = 0;
  state.lastFrameOk = performance.now();
  tracker.tracks = [];
  slow.dets = []; slow.t = null; slow.ranAt = 0; frameCount = 0;
  engine.reset();
  const wasFirst = state.welcomed !== true;
  state.welcomed = true;
  setStatus(RECORD ? 'Running, recording' : 'Running');
  updateMain();
  cues.play('ok');
  say(RECORD ? 'Vision Assist active, recording.'
    : wasFirst ? 'Vision Assist active. Tap the screen, then say where you want to go. Say help to hear what else I can do.'
    : 'Vision Assist active. Detecting obstacles.', 'status');
  startRecording();
  lockScreen();
  loop();
}

function stopInternal() {
  speaker.hold(false);
  state.running = false;
  state.starting = false;
  if (state.timer) clearTimeout(state.timer);
  stopRecording();
  stopCamera();
  releaseScreen();
  try { const c = el.overlay; c.getContext('2d').clearRect(0, 0, c.width, c.height); } catch (_) { /* ignore */ }
  setStatus('Stopped');
  updateMain();
}

function stop() {
  if (!state.running && !state.starting) {
    say('Already stopped. Say start, or tap start.', 'status');
    return;
  }
  stopInternal();
  speaker.cancelAll();
  say('Stopped. Say start to begin again.', 'status');
}

// ---------- talk, main button, how much I say ----------
function updateMain() {
  const b = el.start;
  b.classList.toggle('talk', state.running);
  b.classList.toggle('busy', state.starting);
  const label = state.starting ? 'Starting' : state.running ? 'Talk' : 'Start';
  b.textContent = label;
  b.setAttribute('aria-label', state.running ? 'Talk to Vision Assist. Double tap, then say what you want.' : state.starting ? 'Starting' : 'Start Vision Assist');
}

// The walker taps, the app goes quiet, plays a rising sound, and listens for about 9 seconds.
const TALK_WINDOW_MS = 9000;
function talk() {
  if (!state.running) { start(); return; }
  cues.unlock();
  speaker.hush();
  speaker.hold(true);
  state.talkUntil = performance.now() + TALK_WINDOW_MS;
  state.talkHeard = false;
  cues.play('listen');
  if (!state.listening) startListening();
  setStatus('Listening');
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    speaker.hold(false);
    if (!state.talkHeard && state.running) { cues.play('huh'); setStatus('Running'); logEvent('talk-timeout', ''); }
  }, TALK_WINDOW_MS);
  logEvent('talk', '');
}

const LEVEL_TEXT = {
  quiet: 'Quiet. I will tell you about turns, vehicles, stairs, and people or things right in front of you.',
  normal: 'Normal. I will also tell you about people and vehicles that are near.',
  detailed: 'Detailed. I will also tell you about poles, bins, benches and other things in your way.',
};
function setLevel(level, speak = true, tone = true) {
  if (!LEVELS.includes(level)) return;
  engine.setLevel(level);
  el.level.textContent = `How much I say: ${level}`;
  try { localStorage.setItem('va.level', level); } catch (_) { /* storage can be unavailable */ }
  if (speak) { if (tone) cues.play('ok'); say(LEVEL_TEXT[level], 'status'); } // by voice the command already played its tone
}
function stepLevel(dir) {
  const i = LEVELS.indexOf(engine.level);
  const j = Math.max(0, Math.min(LEVELS.length - 1, i + dir));
  if (j === i) { say(dir < 0 ? 'Already as quiet as I go.' : 'Already giving full detail.', 'status'); return; }
  setLevel(LEVELS[j], true, false);
}

// ---------- things the walker can ask for ----------
function describeNow() {
  if (!state.running || !state.scene) { say(NO_CAMERA, 'status'); return; }
  if (performance.now() - state.scene.t > 5000) { say('The camera view has not updated for a moment. Try again in a few seconds.', 'status'); return; }
  const text = describeScene(state.scene.tracks, state.scene.w);
  logEvent('describe', text);
  say(text, 'status');
  state.lastSpoken = text;
}

async function whereAmI() {
  let pos;
  try { pos = await navigator_.getPosition(); } catch (e) { say(locationMessage(e), 'status'); return; }
  try {
    const text = describePlace(await reverseLookup(pos), pos.accuracy);
    logEvent('whereami', text);
    say(text, 'status'); state.lastSpoken = text;
  } catch (e) {
    logEvent('whereami-error', e && e.message);
    say('I could not look up which street you are on. Check your internet connection.', 'status');
  }
}

async function savePlace(rawName) {
  if (!normaliseName(rawName)) { say('Say save this place as, and a name. For example, save this place as home.', 'status'); return; }
  let pos;
  try { pos = await navigator_.getPosition(); } catch (e) { say(locationMessage(e, 'I cannot find your location, so I could not save this place.'), 'status'); return; }
  const r = places.save(rawName, pos);
  if (!r) { say('I did not catch a name for this place.', 'status'); return; }
  logEvent('save-place', r.name);
  const back = r.name === 'home' ? 'take me home' : `take me to ${r.name}`;
  say(`${r.replaced ? `Updated ${r.name} to this spot.` : `Saved as ${r.name}.`} To come back, say ${back}.` +
    `${pos.accuracy > 40 ? ' My location signal is weak, so this spot may be a little off.' : ''}` +
    `${r.persisted ? '' : ' I could not store it on this phone, so I will only remember it until you close the page.'}`, 'status');
}

function goTo(query) {
  const saved = places.get(query);
  if (saved) { dialogue.navigateToSaved(saved); return; }
  if (normaliseName(query) === 'home') { say('You have not saved a home yet. When you are at home, say save this place as home.', 'status'); return; }
  dialogue.navigateTo(query);
}

const UNIT_SAY = {
  miles: 'Okay, distances in yards and miles.',
  metres: 'Okay, distances in metres.',
};
function changeUnits(mode, speak = true) {
  setUnits(mode);
  el.units.textContent = `Distances in: ${getUnits()}`;
  try { localStorage.setItem('va.units', getUnits()); } catch (_) { /* storage can be unavailable */ }
  if (!speak) return;
  say(getUnits() === 'steps'
    ? `Okay, distances in steps. One step is about ${stepCm()} centimetres, so they are approximate. Say my step is, and a length, to change that.`
    : UNIT_SAY[getUnits()], 'status');
}

// "my step is 60 centimetres", "my steps are shorter", or the Step length button (cycles 50 to 90 cm).
function changeStep(arg, speak = true) {
  const target = arg === 'shorter' ? getStep() - 0.05 : arg === 'longer' ? getStep() + 0.05 : arg;
  if (setStep(target) == null) { say('That does not sound like a step. Try a length between 30 and 120 centimetres, or 1 to 4 feet.', 'status'); return; }
  el.step.textContent = `Step length: ${stepCm()} cm`;
  try { localStorage.setItem('va.step', String(getStep())); } catch (_) { /* storage can be unavailable */ }
  if (speak) say(`Okay. One step is about ${stepCm()} centimetres.${getUnits() === 'steps' ? '' : ' Say use steps to hear distances in steps.'}`, 'status');
}
function cycleStep() { const next = [50, 60, 70, 80, 90].find((c) => c > stepCm()) ?? 50; changeStep(next / 100); }

// Supervisor switches (one address for everyone: no need for ?debug or ?record in the web address).
function setCameraView(on, speak = true) {
  DEBUG = on;
  document.body.classList.toggle('debug', on);
  el.dbg.setAttribute('aria-pressed', String(on));
  el.dbg.textContent = `Camera view: ${on ? 'on' : 'off'}`;
  if (!on) { try { const c = el.overlay; c.getContext('2d').clearRect(0, 0, c.width, c.height); } catch (_) { /* ignore */ } }
  if (speak) say(on ? 'Camera view on.' : 'Camera view off.', 'status');
}
function setRecording(on, speak = true) {
  RECORD = on;
  el.rec.setAttribute('aria-pressed', String(on));
  el.rec.textContent = `Record session: ${on ? 'on' : 'off'}`;
  el.saveRec.hidden = !on;
  if (speak) say(on ? (state.running ? 'Recording is on. It starts the next time you tap start.' : 'Recording is on. It starts when you tap start.') : 'Recording is off.', 'status');
}

const battery = new BatteryWatch({
  getBattery: navigator.getBattery ? navigator.getBattery : null,
  say: (t, k) => say(t, k),
  log: (level, charging) => logEvent('battery', `${Math.round(level * 100)}${charging ? ' charging' : ''}`),
});
let batteryStarted = false;
function startBatteryWatch() { if (batteryStarted) return; batteryStarted = true; battery.start().catch(() => {}); }

function repeat() {
  say(state.lastSpoken || 'Nothing to repeat yet.', 'status');
}

async function lockScreen() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { logEvent('wakelock-error', e && e.name); }
}
function releaseScreen() {
  try { if (wakeLock) wakeLock.release(); } catch (_) { /* ignore */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.running || state.starting)) {
    state.wasRunning = true;
    stopInternal();
    speaker.cancelAll();
  } else if (!document.hidden && state.wasRunning) {
    state.wasRunning = false;
    say('Vision Assist is resuming.', 'status');
    start();
  }
});

// ---------- voice commands ----------
// The microphone can hear our own voice. Only treat speech as an echo while we are speaking, or just
// after (recognition results arrive about a second late), and only if every word was in what we said.
// A real command said after that window always goes through, including "stop" during alerts.
function isEcho(text) {
  const words = text.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const recent = speaker.busy() || Date.now() - speaker.lastEnd < 1200;
  if (!recent) return false;
  return spokenHistory.slice(-3).some((h) => words.every((w) => h.text.includes(w)));
}

function handleTranscript(text) {
  logEvent('heard', text);
  const inTalk = performance.now() < state.talkUntil;
  if (!inTalk && isEcho(text)) { logEvent('ignored-echo', text); return; } // we hushed the app, so nothing we said is an echo
  if (inTalk) { setTimeout(() => speaker.hold(false), 150); /* after the command's own reply is queued, so the answer comes first */ state.talkHeard = true; state.talkUntil = 0; clearTimeout(talkTimer); if (state.running) setStatus('Running'); }
  if (dialogue.answer(text)) { cues.play('ok'); return; } // an answer to a question we asked
  const cmd = parseCommand(text);
  if (cmd.type) cues.play('ok'); else if (inTalk) cues.play('huh');
  switch (cmd.type) {
    case 'describe': describeNow(); break;
    case 'whereami': whereAmI(); break;
    case 'save': savePlace(cmd.arg); break;
    case 'units': changeUnits(cmd.arg); break;
    case 'stepLength': changeStep(cmd.arg); break;
    case 'saveAddress': dialogue.saveAddress(cmd.name, cmd.arg); break;
    case 'battery': say(battery.ask(), 'status'); if (!batteryStarted) startBatteryWatch(); break;
    case 'level':
      if (cmd.arg === 'less') stepLevel(-1); else if (cmd.arg === 'more') stepLevel(1); else setLevel(cmd.arg, true, false);
      break;
    case 'start': start(); break;
    case 'stop': stop(); break;
    case 'repeat': repeat(); break;
    case 'read': readText(); break;
    case 'help': say(HELP_TEXT, 'status'); break;
    case 'cancel': if (!navigator_.cancel()) say('No navigation is active.', 'status'); break;
    case 'navigate':
      goTo(cmd.arg);
      break;
    default: break; // unrecognised speech is ignored; ambient talking should not interrupt
  }
}

function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    say('Voice commands are not supported in this browser. Use the buttons.', 'status');
    return;
  }
  if (state.listening) return;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = CONFIG.speechLang;
  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) handleTranscript(e.results[i][0].transcript);
    }
  };
  recognition.onerror = (e) => {
    logEvent('mic-error', e.error);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      state.listening = false;
      say('Microphone permission was denied. Voice commands are off. Use the buttons, or allow the microphone in Chrome site settings.', 'status');
    } else if (e.error === 'network') {
      state.listening = false;
      say('Voice commands need an internet connection. Use the buttons.', 'status');
    }
    updateMic();
  };
  recognition.onend = () => {
    if (state.listening) setTimeout(() => { try { recognition.start(); } catch (_) { /* already started */ } }, 300);
    updateMic();
  };
  state.listening = true;
  try { recognition.start(); } catch (e) { logEvent('mic-start-error', e && e.message); }
  updateMic();
}

function stopListening() {
  state.listening = false;
  try { if (recognition) recognition.stop(); } catch (_) { /* ignore */ }
  updateMic();
}

function updateMic() {
  el.mic.setAttribute('aria-pressed', String(state.listening));
  el.mic.textContent = state.listening ? 'Voice commands on' : 'Voice commands off';
}

// ---------- buttons ----------
el.start.addEventListener('click', () => { cues.unlock(); if (state.running) talk(); else start(); });
el.units.addEventListener('click', () => changeUnits(UNIT_MODES[(UNIT_MODES.indexOf(getUnits()) + 1) % UNIT_MODES.length]));
el.step.addEventListener('click', cycleStep);
el.dbg.addEventListener('click', () => setCameraView(!DEBUG));
el.rec.addEventListener('click', () => setRecording(!RECORD));
el.level.addEventListener('click', () => setLevel(LEVELS[(LEVELS.indexOf(engine.level) + 1) % LEVELS.length]));
el.tap.addEventListener('click', () => {
  state.tapToTalk = !state.tapToTalk;
  el.tap.setAttribute('aria-pressed', String(state.tapToTalk));
  el.tap.textContent = `Tap anywhere to talk: ${state.tapToTalk ? 'on' : 'off'}`;
  try { localStorage.setItem('va.tap', state.tapToTalk ? '1' : '0'); } catch (_) { /* ignore */ }
  say(state.tapToTalk ? 'Tap anywhere to talk is on.' : 'Tap anywhere to talk is off. Use the Talk button.', 'status');
});
// While running, a tap on empty screen is the same as the Talk button, so there is nothing to find.
document.addEventListener('click', (e) => {
  if (!state.running || !state.tapToTalk) return;
  if (e.target.closest && e.target.closest('button, input, summary, details, label, a, select, form')) return;
  const now = performance.now();
  if (now - state.lastTapAt < 1500) return; // ignore bounces and pocket drumming
  state.lastTapAt = now;
  talk();
});
el.stop.addEventListener('click', stop);
el.repeat.addEventListener('click', repeat);
el.mic.addEventListener('click', () => {
  if (state.listening) { stopListening(); say('Voice commands off.', 'status'); }
  else { startListening(); say('Voice commands on. Say help for commands.', 'status'); }
});
el.dl.addEventListener('click', () => {
  download(sessionBlob(), `vision-assist-log-${Date.now()}.json`);
  say('Session log saved.', 'status');
});
el.saveRec.addEventListener('click', () => {
  if (!recBlob || !recBlob.size) return;
  const ext = (recBlob.type || '').includes('mp4') ? 'mp4' : 'webm';
  const stamp = Date.now();
  download(recBlob, `vision-assist-video-${stamp}.${ext}`);
  setTimeout(() => download(sessionBlob(), `vision-assist-log-${stamp}.json`), 1000);
  say('Saving the video and the log.', 'status');
});
setRecording(RECORD, false);

setCameraView(DEBUG, false);
try {
  const lv = localStorage.getItem('va.level'); if (LEVELS.includes(lv)) engine.setLevel(lv);
  const un = localStorage.getItem('va.units'); if (UNIT_MODES.includes(un)) setUnits(un);
  const st = parseFloat(localStorage.getItem('va.step')); if (st) setStep(st);
  if (localStorage.getItem('va.tap') === '0') { state.tapToTalk = false; el.tap.setAttribute('aria-pressed', 'false'); el.tap.textContent = 'Tap anywhere to talk: off'; }
} catch (_) { /* storage can be unavailable */ }
el.level.textContent = `How much I say: ${engine.level}`;
el.units.textContent = `Distances in: ${getUnits()}`;
el.step.textContent = `Step length: ${stepCm()} cm`;
updateMain();
updateMic();
window.__va = { handleTranscript, state, speaker, session, tracker, engine, cues, places, battery, start, stop, talk, setLevel, describeNow, whereAmI, savePlace, changeUnits, changeStep, setCameraView, setRecording, dialogue,
  rec: () => ({ size: recBlob ? recBlob.size : null, mime: recMime, frames: frameLog.length }) };
