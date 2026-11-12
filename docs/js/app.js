// Vision Assist - app wiring: camera, detection loop, speech, voice commands, error handling.
// Rule for this file: every failure is spoken. No silent states.
import { CONFIG, MODELS, pickModel, canonical, SECONDARY, TERTIARY, WATCH_CLASSES, HAZARD, GOOGLE_KEY, FEATURES, IGNORE_FAST, hazardOnByDefault } from './config.js';
import { filterAllowed, mergeLanes, confirmSlow } from './lanes.js';
import { Detector } from './detector.js';
import { Tracker } from './tracker.js';
import { AlertEngine, LEVELS, inCorridor, directionOf, VEHICLES } from './alerts.js';
import { Haptics } from './haptics.js';
import { RouteStore, RouteRecorder, routeFromPoints, pathLength } from './routes.js';
import { Cues } from './cues.js';
import { getUnits, setUnits, getStep, setStep, stepCm, UNIT_MODES } from './units.js';
import { describeScene, NO_CAMERA, findObject } from './describe.js';
import { CameraWatch, frameStats, greyFromVideo } from './camcheck.js';
import { warmModel } from './modelcache.js';
import { CloudListener } from './cloudstt.js';
import { DepthLane } from './depth.js';
import { NoteStore, crossingAdvice } from './notes.js';
import { reverseLookup, describePlace, PlaceStore, normaliseName } from './places.js';
import { BatteryWatch } from './battery.js';
import { Speaker, stepRate, RATES } from './speech.js';
import { explainAlert, selfCheckText } from './trustcheck.js';
import { parseCommand, HELP_TEXT } from './commands.js';
import { Navigator, makeProviders, locationMessage, haversine, roundMetres } from './nav.js';
import { looksLikeEcho, isBargeIn } from './barge.js';
import { Dialogue, parseAnswer } from './dialogue.js';
import { recogniseText, readingSpeech } from './reader.js';
import { CloudVision, parseRead, sceneSpeech, frameToBase64 } from './cloudvision.js';
import { searchNearby, nearbySpeech, WalkHeading } from './nearby.js';
import { CROSSING_TEXT, LIMITS_TEXT } from './safetext.js';
import { firstStartPrivacy, PRIVACY_TEXT, RecordingConsent } from './privacy.js';
import { OnlineWatch, updateNotice } from './pwa.js';
import { PerfMeter, SlowMode, WalkStats, summaryText } from './perf.js';
import { CloudVoice, WARM_LINES } from './cloudtts.js';
import { routeOutput, OUTPUT_MODES, OUTPUT_NAMES, outputText } from './output.js';
import { hazardCandidates } from './hazardalerts.js';
import { floorDistance, pitchFromBeta, parseHeight, cameraHeightM, PitchCalibrator } from './floordist.js';

const params = new URLSearchParams(location.search);
// Listening: Google Cloud Speech-to-Text, tap to talk (default), or Chrome's own always-on recogniser (?stt=chrome, and the
// automatic fallback when Google cannot be reached).
const WANT_CLOUD_STT = params.get('stt') !== 'chrome' && !!GOOGLE_KEY;
const { key: MODEL_KEY, size: SIZE } = pickModel(params.get('model'), params.get('size'), CONFIG.inputSize);
const MODEL = MODELS[MODEL_KEY];
let DEBUG = params.has('debug'); // supervisor: show the camera view and boxes. ?debug still works, but there is a switch in More options
let RECORD = false; // supervisor: record raw video + per-frame detections for review (switch in More options too)
const WANT_RECORD = params.has('record'); // ?record asks for consent at start, like the switch does (Package A)
const consent = new RecordingConsent();
const EP = params.get('ep') || 'wasm';

const $ = (id) => document.getElementById(id);
const el = {
  start: $('startBtn'), talk: $('talkBtn'), output: $('outputBtn'), sr: $('srBtn'), srLive: $('srLive'), repeat: $('repeatBtn'), mic: $('micBtn'),
  status: $('status'), last: $('lastAlert'), stats: $('stats'), video: $('video'), overlay: $('overlay'),
  dl: $('logBtn'), saveRec: $('saveRecBtn'), level: $('levelBtn'), tap: $('tapBtn'), units: $('unitsBtn'), step: $('stepBtn'), rate: $('rateBtn'), shareBtn: $('shareBtn'), dbg: $('debugBtn'), rec: $('recordBtn'),
};

// The app's voice: Google Cloud Text-to-Speech, with the phone's own voice whenever Google cannot be reached (cloudtts.js).
// ?voice=phone uses the phone's voice only.
let ttsRefusedSaid = false;
const cloudVoice = params.get('voice') === 'phone' || !GOOGLE_KEY ? null : new CloudVoice({
  key: GOOGLE_KEY, lang: CONFIG.speechLang, voice: CONFIG.ttsVoice,
  log: (k, v) => {
    logEvent(k, v);
    if (k === 'cloud-tts-refused' && !ttsRefusedSaid) { ttsRefusedSaid = true; say("Google voice is not switched on for this app, so I am using the phone's voice.", 'status'); }
  },
});
const ttsAudio = typeof Audio !== 'undefined' ? new Audio() : null;
function playTts(url, onEnd, onError) {
  ttsAudio.onended = onEnd; ttsAudio.onerror = onError;
  ttsAudio.src = url;
  const p = ttsAudio.play(); if (p && p.catch) p.catch(onError);
  return { stop() { ttsAudio.onended = null; ttsAudio.onerror = null; try { ttsAudio.pause(); } catch (_) { /* ignore */ } } };
}
const speaker = new Speaker(window.speechSynthesis, window.SpeechSynthesisUtterance, {
  rate: CONFIG.speechRate, lang: CONFIG.speechLang, staleMs: CONFIG.staleMs,
  cloud: cloudVoice, player: cloudVoice && ttsAudio ? playTts : null,
});
const tracker = new Tracker();
const engine = new AlertEngine(CONFIG, CONFIG.verbosity);
const haptics = new Haptics();
const routes = new RouteStore();
const routeRecorder = new RouteRecorder();
let recWatch = null, recAnnounced = 0;
const cues = new Cues();
const places = new PlaceStore();
const notes = new NoteStore();
let detector = null;
let slowDetector = null; // second model for stairs, manholes, benches...
const slow = { dets: [], t: null, ranAt: 0 };
let cocoDetector = null; // optional third model (docs/models/coco320.onnx); silent when the file is not there
const coco = { dets: [], t: null, ranAt: 0 };
const hazard = { dets: [], t: null, ranAt: 0 }; // open-vocabulary hazard lane: log and on-request only
let hazardDetector = null;
const HAZARD_CONFIRM = Object.fromEntries((HAZARD.speakClasses || []).map((n) => [canonical(n), { minScore: HAZARD.conf, runs: 2 }]));
let frameCount = 0;
// Walk measurements (Package C): a 'perf' event every 30 s, slow-phone mode, and a summary of each walk.
const perf = new PerfMeter();
const slowMode = new SlowMode();
const walk = new WalkStats();
const PERF_EVERY_MS = 30000;
// Floor-based distance (Package F). ?dist=floor speaks it (not for vehicles: their warnings keep the measured box distance
// and speed); without the flag it is only logged next to the box estimate for every alert.
const DIST_FLOOR = params.get('dist') === 'floor';
const DEFAULT_HEIGHT_CM = 170;
let lastBeta = null;
const calibrator = new PitchCalibrator();
const floorCal = (() => { try { return JSON.parse(localStorage.getItem('va.floor')) || {}; } catch (_) { return {}; } })();
function saveFloorCal() { try { localStorage.setItem('va.floor', JSON.stringify(floorCal)); } catch (_) { /* storage can be unavailable */ } }
window.addEventListener('deviceorientation', (e) => { lastBeta = e.beta; calibrator.add(e.beta, performance.now()); });
function floorFor(tr, frameH) {
  const pitch = pitchFromBeta(lastBeta) ?? floorCal.pitch ?? null; // live tilt first; the calibrated one if there is no sensor
  return floorDistance({ yBottom: tr.box.y2, frameH, pitchDeg: pitch, camHeightM: cameraHeightM(floorCal.heightCm || DEFAULT_HEIGHT_CM, CONFIG.floor.heightShare),
    vfovDeg: CONFIG.floor.vfovDeg, edgeMargin: CONFIG.floor.edgeMargin, minAngleDeg: CONFIG.floor.minAngleDeg });
}
let fpsTick = { t: 0, frames: 0 };
const batteryNow = () => (battery && battery.battery ? { level: battery.battery.level, charging: !!battery.battery.charging } : { level: null, charging: false });
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

// What the app is doing, shown as a coloured chip (NAVI AI idea): Ready, Watching, Listening, Thinking, Speaking.
// Hidden from screen readers: TalkBack already hears the speech, and a changing label would make it talk twice.
function setMode(m) { const e = document.getElementById('mode'); if (e) { e.textContent = m; e.dataset.m = m; } }
function idleMode() { setMode(!state.running ? 'Ready' : performance.now() < state.talkUntil ? 'Listening' : 'Watching'); }
// The conversation on screen: what the walker said and what the app answered, newest at the bottom, last 30.
function addConvo(who, text) {
  const ol = document.getElementById('convoLog'); if (!ol) return;
  const li = document.createElement('li'); li.className = who === 'You' ? 'you' : 'app';
  li.textContent = `${who}: ${text}`; ol.appendChild(li);
  while (ol.children.length > 30) ol.removeChild(ol.firstChild);
  ol.scrollTop = ol.scrollHeight;
}
speaker.onIdle = () => idleMode();

speaker.onSpoken = (item) => {
  setMode('Speaking'); addConvo('App', item.text);
  state.lastSpeechAt = performance.now();
  state.lastSpoken = item.kind === 'status' ? state.lastSpoken : item.text;
  spokenHistory.push({ text: item.text.toLowerCase(), t: performance.now() });
  if (spokenHistory.length > 8) spokenHistory.shift();
  el.last.textContent = item.text;
  session.events.push({ t: Date.now(), kind: item.kind, text: item.text });
};

// Output settings (Package D): output mode (speech and vibration / vibration only / speech only) and screen reader mode.
const out = { mode: 'both', screenReader: false };
// In screen reader mode, status lines go to the live region for TalkBack to read; warnings and turns are still spoken.
function toLive(text) {
  const r = el.srLive; if (!r) return;
  r.textContent = ''; setTimeout(() => { r.textContent = text; }, 50); // cleared first, so the same line is read again
  el.last.textContent = text; addConvo('App', text);
  session.events.push({ t: Date.now(), kind: 'status-live', text });
}
function say(text, kind = 'status') {
  const route = routeOutput(kind, out);
  if (route.live) { toLive(text); state.lastSpeechAt = performance.now(); return; }
  if (!speaker.supported) setStatus('Speech is not available on this phone. Alerts will only show on screen.');
  speaker.speak(text, kind);
}

let lastTraceAt = 0;
const navigator_ = new Navigator({
  say: (t, k) => { const hk = out.mode !== 'speech' && Haptics.kindForNav(t); if (hk) haptics.buzz(hk); say(t, k); }, // turn left / right, arrived, lost signal
  trace: (f) => { const n = Date.now(); if (n - lastTraceAt < 3000) return; lastTraceAt = n; logEvent('fix', JSON.stringify(f)); },
  providers: makeProviders({
    googleKey: new URLSearchParams(location.search).get('maps') === 'osm' ? '' : GOOGLE_KEY,
    onFallback: (what, e) => session.events.push({ t: Date.now(), kind: 'nav-fallback', text: `${what}: ${e && e.message}` }),
    notify: (t) => say(t, 'status'), // "Google directions are not available, using backup maps." (Package G)
  }),
  // The first fix Chrome gives is often a rough network guess (it can be streets out). So wait up to 10 seconds for a
  // proper GPS fix (25 m or better) and use the best one seen.
  getPosition: () => new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('no geolocation'));
    // A good fix from the last few seconds (the app asks for location when it opens) is used straight away, like a map app does.
    const c = window.__lastFix;
    if (c && Date.now() - c.t < 20000 && c.accuracy <= 50) return res({ lat: c.lat, lon: c.lon, accuracy: c.accuracy });
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
      window.__lastFix = { ...f, t: Date.now() }; feedHeading(p);
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
    (p) => { feedHeading(p); ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }); }, err,
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
    let parsed = null;
    if (vision && vision.usable) {
      // Google reads signs, shop names and print far better than the phone; one photo is sent, only because the walker asked
      try { parsed = parseRead(await vision.annotate(c.toDataURL('image/jpeg', 0.85).split(',')[1], 'read')); } catch (_) { parsed = null; }
    }
    if (!parsed) parsed = await recogniseText(c, { onLoading: () => say('Getting the reading tool ready. This takes a few seconds the first time.', 'status') });
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

// Step C: a class the walker never hears about yet, straight from the raw model output (not the tracker or alert
// engine, so this cannot change anything that is actually spoken). Watch the session log for false alarms.
// Hazard lane sightings for review against the video: name|score|side|height of the box as a share of the picture.
// Throttled like the watch classes.
function logHazards(dets, w, h) {
  const now = performance.now();
  for (const d of dets) {
    const k = 'hz:' + d.name;
    if (now - (watchLoggedAt.get(k) ?? -1e9) < 2000) continue;
    watchLoggedAt.set(k, now);
    logEvent('hazard-detect', `${d.name}|${d.score.toFixed(2)}|${directionOf((d.x1 + d.x2) / 2, w)}|${((d.y2 - d.y1) / h).toFixed(2)}`);
  }
}
// At most once per class every 2 s, so a traffic light in view for a minute cannot push the start of a walk out of the
// 2000-event log.
const watchLoggedAt = new Map();
function logWatchClasses(dets, names) {
  const now = performance.now();
  for (const d of filterAllowed(dets, names)) {
    if (now - (watchLoggedAt.get(d.name) ?? -1e9) < 2000) continue;
    watchLoggedAt.set(d.name, now);
    logEvent('watch-detect', `${d.name}|${(d.score ?? 0).toFixed(2)}`);
  }
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
  window.ort.env.wasm.wasmPaths = window.ORT_BASE || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/'; // our own copy first, the CDN only if that fails
  const d = new Detector(window.ort, SIZE, MODEL.names);
  const t0 = performance.now();
  await d.load(MODEL.url(SIZE), [EP]);
  session.modelLoadMs = Math.round(performance.now() - t0);
  detector = d;
}

// The stairs / manhole lane (and the optional coco lane) load after the app is already running,
// so the walker is not kept waiting for a second 12 MB model. Until it is ready the fast lane works alone.
let lanesLoading = null;
const USE_DEPTH = params.get('depth') === '1'; // test only: measure a depth model's speed on the phone
let depthLane = null;
// The hazard lane (40 MB YOLOE) runs in the same loop as the main detector, so each run holds up live detection for a
// second or more on the Poco. While it speaks nothing (speakClasses empty) it only runs when asked for with ?hazard=on
// (for logging walks). Field test, 8 Nov: detection did not feel real-time with it on.
function hazardWanted() { return params.get('hazard') !== 'off' && (params.get('hazard') === 'on' || HAZARD_ON_BY_DEFAULT); }
const HAZARD_ON_BY_DEFAULT = hazardOnByDefault(HAZARD);
function loadLanes() {
  if (!USE_SLOW || lanesLoading) return lanesLoading;
  lanesLoading = (async () => {
    if (!slowDetector) {
      try {
        const sm = MODELS[SECONDARY.model];
        const sd = new Detector(window.ort, SECONDARY.size, sm.names);
        await sd.load(sm.url(SECONDARY.size), [EP]);
        slowDetector = sd;
        logEvent('slow-model-ready', String(Math.round(performance.now())));
      } catch (e) {
        logEvent('slow-model-error', e && e.message);
        if (state.running) say('Stairs and manhole detection could not load. Other detection is working.', 'status');
      }
    }
    if (USE_DEPTH && !depthLane) {
      try { const dl = new DepthLane(window.ort); await dl.load((k, v) => logEvent(k, v)); depthLane = dl; logEvent('depth-ready', ''); }
      catch (e) { logEvent('depth-error', e && e.message); }
    }
    if (!cocoDetector) {
      try {
        const cm = MODELS[TERTIARY.model];
        const cd = new Detector(window.ort, TERTIARY.size, cm.names);
        await cd.load(cm.url(TERTIARY.size), [EP]);
        cocoDetector = cd;
      } catch (e) { logEvent('coco-model-missing', e && e.message); } // optional: no message to the walker
    }
    if (!hazardDetector && hazardWanted()) {
      try {
        const hd = new Detector(window.ort, HAZARD.size, HAZARD.names);
        await hd.load(HAZARD.file, [EP]);
        hazardDetector = hd; logEvent('hazard-model-ready', String(Math.round(performance.now())));
      } catch (e) { logEvent('hazard-model-missing', e && e.message); } // optional, and silent: the file may not be deployed yet
    }
  })();
  return lanesLoading;
}

// While the page sits open (before Start is tapped) fetch the files into the browser cache, so Start is quicker.
function prefetchAssets() {
  const go = () => {
    try {
      const urls = [MODEL.url(SIZE)];
      if (USE_SLOW) urls.push(MODELS[SECONDARY.model].url(SECONDARY.size));
      if (HAZARD_ON_BY_DEFAULT && params.get('hazard') !== 'off') urls.push(HAZARD.file); // only once a class may speak
      urls.forEach((u) => warmModel(u).catch(() => {}));
    } catch (_) { /* best effort only */ }
  };
  if (navigator.connection && navigator.connection.saveData) return;
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(go);
}

// Silence must never mean "I cannot see": say so when the camera is dark or covered.
const camWatch = new CameraWatch({ say: (t, k) => say(t, k), log: (k, v) => logEvent(k, v) });
let camCheckedAt = 0;
function checkCamera(t) {
  if (t - camCheckedAt < 1000) return;
  camCheckedAt = t;
  try { const g = greyFromVideo(el.video); if (g) camWatch.update(frameStats(g), t); } catch (_) { /* never break detection over this */ }
}

// ---------- main loop ----------
async function loop() {
  if (!state.running) return;
  const t0 = performance.now();
  try {
    const { dets: fastAll, width, height } = await detector.detect(el.video, CONFIG.confThreshold, CONFIG.nmsIou);
    perf.lane('main', performance.now() - t0);
    const fast = fastAll.filter((d) => !IGNORE_FAST.includes(d.name));
    if (!state.running) return; // stopped while this frame was in flight
    frameCount += 1; perf.frame();
    // In slow-phone mode the extra lanes run half as often (the hazard lane not at all); the main lane never slows.
    if (slowDetector && performance.now() - slow.ranAt >= slowMode.every(SECONDARY.everyMs)) {
      slow.ranAt = performance.now();
      try {
        const r = await slowDetector.detect(el.video, SECONDARY.conf, CONFIG.nmsIou);
        perf.lane('rod2', performance.now() - slow.ranAt);
        logWatchClasses(r.dets, WATCH_CLASSES.rod2);
        const c = confirmSlow(filterAllowed(r.dets, SECONDARY.classes), slow.prevNames, SECONDARY.confirm || {});
        slow.dets = c.dets; slow.prevNames = c.names;
        slow.t = performance.now();
      } catch (e) { logEvent('slow-frame-error', e && e.message); }
      if (!state.running) return;
    }
    if (cocoDetector && performance.now() - coco.ranAt >= slowMode.every(TERTIARY.everyMs)) {
      coco.ranAt = performance.now();
      try {
        const r = await cocoDetector.detect(el.video, TERTIARY.conf, CONFIG.nmsIou);
        perf.lane('coco', performance.now() - coco.ranAt);
        logWatchClasses(r.dets, WATCH_CLASSES.coco);
        coco.dets = filterAllowed(r.dets, TERTIARY.classes).map((d) => ({ ...d, cls: d.cls + TERTIARY.clsOffset }));
        coco.t = performance.now();
      } catch (e) { logEvent('coco-frame-error', e && e.message); }
      if (!state.running) return;
    }
    if (depthLane && depthLane.due(performance.now())) {
      try { const ms = await depthLane.run(el.video, performance.now()); if (RECORD) logEvent('depth-ms', String(Math.round(ms))); } catch (e) { logEvent('depth-frame-error', e && e.message); }
      if (!state.running) return;
    }
    if (hazardDetector && performance.now() - hazard.ranAt >= slowMode.every(HAZARD.everyMs, true)) {
      hazard.ranAt = performance.now();
      try {
        const r = await hazardDetector.detect(el.video, HAZARD.conf, CONFIG.nmsIou);
        perf.lane('hazard', performance.now() - hazard.ranAt);
        hazard.dets = r.dets.map((d) => ({ ...d, box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, w: r.width }));
        // A class that may speak must be seen in two hazard runs in a row (like stairs in the slow lane).
        const hc = confirmSlow(hazard.dets, hazard.prevNames, HAZARD_CONFIRM);
        hazard.confirmed = hc.dets.filter((d) => HAZARD_CONFIRM[d.name]); hazard.prevNames = hc.names; hazard.h = r.height;
        hazard.t = performance.now();
        logHazards(r.dets, r.width, r.height);
      } catch (e) { logEvent('hazard-frame-error', e && e.message); }
      if (!state.running) return;
    }
    const t = performance.now();
    const dets = mergeLanes(mergeLanes(fast, slow, t, SECONDARY.maxAgeMs), coco, t, TERTIARY.maxAgeMs);
    const tracks = tracker.update(dets, t, width, height);
    state.scene = { tracks, w: width, h: height, t };
    const hzFresh = hazard.confirmed && hazard.t != null && t - hazard.t <= HAZARD.maxAgeMs;
    const forEngine = DIST_FLOOR ? tracks.map((tr) => (VEHICLES.has(tr.name) ? tr : { ...tr, dist: floorFor(tr, height) ?? tr.dist })) : tracks;
    const alert = engine.next(forEngine, width, height, t, hzFresh ? hazardCandidates(hazard.confirmed, width, height, HAZARD.speakClasses, { corridor: CONFIG.corridor }) : []);
    if (alert && (alert.urgent || performance.now() > state.talkUntil)) { // routine alerts wait while the walker is speaking
      const route = routeOutput(alert.urgent ? 'urgent' : 'normal', out); // vibration only: buzz instead, but vehicles are still spoken
      if (alert.urgent) cues.play('urgent');
      const hk = route.vibrate && Haptics.kindFor(alert, out.mode); if (hk) haptics.buzz(hk);
      if (route.speak) speaker.speak(alert.text, alert.urgent ? 'urgent' : 'normal');
      else { el.last.textContent = alert.text; state.lastSpoken = alert.text; }
      logEvent('alert', `${alert.priority}|${alert.text}`);
      walk.alert(alert.text, alert.priority);
      const at = tracks.find((x) => x.id === alert.trackId);
      if (at) logEvent('alert-dist', JSON.stringify({ text: alert.text, name: at.name, box: at.dist == null ? null : +at.dist.toFixed(2), floor: (() => { const f = floorFor(at, height); return f == null ? null : +f.toFixed(2); })(), used: DIST_FLOOR && !VEHICLES.has(at.name) ? 'floor' : 'box', pitch: pitchFromBeta(lastBeta) }));
      state.lastAlertText = alert.text;
      state.lastAlert = alert;
    }
    checkCamera(t);
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
    `(${(1000 / med).toFixed(1)} frames/s). Model ${MODEL_KEY} ${SIZE}px${slowDetector ? ' + stairs lane' : ''}${cocoDetector ? ' + coco lane' : ''}${depthLane && depthLane.medianMs() != null ? ` + depth lane ${depthLane.medianMs().toFixed(0)} ms` : ''}, ${EP}, ` +
    `${window.ort ? window.ort.env.wasm.numThreads : '?'} thread(s)${self.crossOriginIsolated ? ', isolated' : ''}.`;
}

// Supervisor view only: a risk level and moving / still for each object, like NAVI AI's obstacle card.
// high = a vehicle coming fast (what triggers "Caution"); caution = in the walking path and within 3 m; low = the rest.
function riskOf(tr, w, h) {
  const vehicle = ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'tricycle'].includes(tr.name);
  const sp = tr.speed;
  const move = sp == null ? '' : (Math.abs(sp) > 0.8 || Math.abs(tr.lat || 0) > 0.15) ? 'moving' : 'still';
  const limit = tr.dist != null && tr.dist < (CONFIG.closeVehicleMetres ?? 0) ? CONFIG.approachSpeedMps : ((CONFIG.speedingMps || {})[tr.name] ?? CONFIG.approachSpeedMps);
  const enough = tr.speedN == null ? (tr.hits ?? 0) >= CONFIG.approachMinHits : tr.speedN >= (CONFIG.approachMinSamples ?? 5);
  if (vehicle && sp != null && sp > limit && enough) return { risk: 'high', move };
  if (inCorridor(tr.box, w, h, CONFIG.corridor) && tr.dist != null && tr.dist < 3) return { risk: 'caution', move };
  return { risk: 'low', move };
}

function drawOverlay(tracks, w, h) {
  const c = el.overlay;
  if (c.width !== w) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.lineWidth = 3; g.font = '20px sans-serif';
  const cor = CONFIG.corridor; // the walking corridor, so a supervisor can see what counts as "in the way"
  g.strokeStyle = '#00e5ff'; g.beginPath();
  g.moveTo(w * (0.5 - cor.topHalf), h * cor.topY); g.lineTo(w * (0.5 + cor.topHalf), h * cor.topY);
  g.lineTo(w * (0.5 + cor.bottomHalf), h); g.lineTo(w * (0.5 - cor.bottomHalf), h); g.closePath(); g.stroke();
  for (const tr of tracks) {
    const r = riskOf(tr, w, h);
    const col = r.risk === 'high' ? '#ff3b30' : r.risk === 'caution' ? '#ff9f0a' : '#34c759';
    g.strokeStyle = col; g.fillStyle = col;
    g.strokeRect(tr.box.x1, tr.box.y1, tr.box.x2 - tr.box.x1, tr.box.y2 - tr.box.y1);
    const d = tr.dist != null ? ` ${tr.dist.toFixed(1)}m` : '';
    g.fillText(`${tr.name}${d} ${r.move} ${r.risk.toUpperCase()}`, tr.box.x1 + 4, Math.max(20, tr.box.y1 + 20));
  }
  if (depthLane) depthLane.draw(g, w);
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
  if (!RECORD || !stream || (recorder && recorder.state === 'recording')) return;
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
  logEvent('record-start', recMime); // time zero of the video, so a reviewer can line the log up with it (tools/score_walk.mjs)
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
// Once a second while running: main-lane speed for slow-phone mode, and the 30 s 'perf' event.
function measure(now) {
  if (fpsTick.t && now > fpsTick.t) {
    const change = slowMode.update(((frameCount - fpsTick.frames) * 1000) / (now - fpsTick.t), now);
    if (change === 'slow') { logEvent('slow-mode', 'on'); const t = slowMode.announce(); if (t) say(t, 'status'); }
    else if (change === 'normal') logEvent('slow-mode', 'off');
  }
  fpsTick = { t: now, frames: frameCount };
  if (now - perf.since < PERF_EVERY_MS) return;
  const snap = perf.snapshot(now), b = batteryNow();
  const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  logEvent('perf', JSON.stringify({ fps: snap.fps, ms: snap.ms, battery: b.level, charging: b.charging, heapMB: heap, slow: slowMode.slow }));
  walk.perf(snap.fps, b.level, b.charging);
}

setInterval(() => {
  navigator_.tick(); // speaks if location updates stop, even when the camera side is not running
  if (!state.running) return;
  const now = performance.now();
  measure(now);
  if (now - state.lastFrameOk > 5000 && now - state.lastWarnAt > 10000) {
    state.lastWarnAt = now;
    say('Detection has paused. Retrying.', 'status');
  } else if (engine.level !== 'quiet' && now - state.lastSpeechAt > CONFIG.heartbeatMs) { // quiet mode: silence means nothing new
    say('Still scanning, nothing recognised.', 'normal');
  }
}, 1000);

// No signal: obstacle warnings still work (the models and app are kept on the phone); say so, and when it is back.
const online = new OnlineWatch({ say: (t, k) => { logEvent('online', t); say(t, k); } });
window.addEventListener('offline', () => { if (state.running) online.update(false); else online.online = false; });
window.addEventListener('online', () => { if (state.running) online.update(true); else { online.online = true; online.saidOffline = false; } });

// ---------- start / stop ----------
async function start() {
  if (state.running || state.starting) return;
  state.starting = true;
  cues.unlock();
  startBatteryWatch();
  updateMain();
  setStatus('Starting');
  cues.play('ok'); // a short sound to show it has started
  if (cloudVoice) cloudVoice.warm(WARM_LINES, speaker.rate); // common lines ready in Google's voice before they are needed
  if (useCloud()) cloud._mic().catch((e) => { logEvent('mic-error', e && e.name); cloudOff = true; startListening(); }); // inside the tap, so the browser allows the microphone prompt
  else startListening();
  try { navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }); } catch (_) { /* ask for location now, so the prompt is not a surprise mid-walk */ }
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
  setMode('Watching');
  state.starting = false;
  state.errors = 0;
  state.lastFrameOk = performance.now();
  tracker.tracks = [];
  slow.dets = []; slow.t = null; slow.ranAt = 0; slow.prevNames = null; frameCount = 0;
  hazard.confirmed = []; hazard.prevNames = null; hazard.t = null;
  perf.reset(performance.now()); slowMode.reset(); fpsTick = { t: 0, frames: 0 }; walk.start(Date.now(), batteryNow().level);
  engine.reset();
  camWatch.reset(); camCheckedAt = 0;
  const wasFirst = state.welcomed !== true;
  state.welcomed = true;
  setStatus(RECORD ? 'Running, recording' : 'Running');
  updateMain();
  cues.play('ok');
  say(RECORD ? 'Ready, recording.' : wasFirst ? 'Ready. Hold the phone at chest height, camera facing forward. Keep using your cane or guide dog. This app helps, but does not replace them. Tap the screen, then speak.' : 'Ready.', 'status');
  const priv = firstStartPrivacy(); if (priv) { say(priv, 'status'); logEvent('privacy-said', ''); } // once ever, on the first start
  const upd = updateNotice(document.getElementById('ver')?.textContent); if (upd) say(upd, 'status'); // a new version since the last start
  online.start(navigator.onLine);
  if (WANT_RECORD && !RECORD && !state.recordAsked) { state.recordAsked = true; setRecording(true); }
  startRecording();
  lockScreen();
  loop();
  loadLanes();
  setTimeout(() => runSelfCheck(wasFirst), 2500); // after the welcome; on later starts only problems are spoken
}

// What is and is not working, in one line (trust: silence must never be mistaken for "all fine").
async function runSelfCheck(full) {
  let battery = null, charging = false;
  try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = b.level; charging = b.charging; } } catch (_) { /* not available */ }
  const fixAge = window.__lastFix ? Date.now() - window.__lastFix.t : Infinity;
  const text = selfCheckText({
    camera: state.running && !!(el.video && el.video.srcObject),
    location: state.locProblem ? false : (fixAge < 120000 ? true : null),
    internet: online.saidOffline ? null : navigator.onLine, // the walker has just been told about no internet: not twice
    listening: WANT_CLOUD_STT ? (cloudOff ? false : true) : null,
    battery, charging,
  }, full);
  logEvent('selfcheck', text || 'ok');
  if (text) say(text, 'status');
}

function stopInternal() {
  if (state.running && walk.startedAt != null) {
    walk.stop(Date.now(), batteryNow().level);
    logEvent('walk-summary', JSON.stringify(walk.summary(Date.now())));
  }
  speaker.hold(false);
  stopListening(); // nothing should hear the app's own 'Stopped' and treat it as a command
  state.running = false;
  state.starting = false;
  if (state.timer) clearTimeout(state.timer);
  stopRecording();
  stopCamera();
  releaseScreen();
  try { const c = el.overlay; c.getContext('2d').clearRect(0, 0, c.width, c.height); } catch (_) { /* ignore */ }
  setStatus('Stopped'); setMode('Ready');
  cloud.close(); // let go of the microphone
  updateMain();
}

function stop() {
  if (!state.running && !state.starting) {
    say('Already stopped.', 'status');
    return;
  }
  stopInternal();
  speaker.cancelAll();
  say('Stopped.', 'status'); // the microphone is off now, so only the button starts it again
}

// ---------- talk, main button, how much I say ----------
function updateMain() {
  const b = el.start;
  b.classList.toggle('running', state.running);
  b.classList.toggle('busy', state.starting);
  b.textContent = state.starting ? 'Starting' : state.running ? 'Stop walking' : 'Start walking'; // the visible text is the name
}

const vision = GOOGLE_KEY && params.get('vision') !== 'phone' ? new CloudVision({ key: GOOGLE_KEY, log: (k, v) => logEvent(k, v) }) : null;
const walkHeading = new WalkHeading();
function feedHeading(p) {
  try { const c = p.coords; walkHeading.add({ lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, heading: c.heading, speed: c.speed, t: Date.now() }); } catch (_) { /* ignore */ }
}
const cloud = new CloudListener({ key: GOOGLE_KEY, lang: CONFIG.speechLang, log: (k, v) => logEvent(k, v) });
let cloudOff = false;
const useCloud = () => WANT_CLOUD_STT && !cloudOff && cloud.usable;
function endTalk() { speaker.hold(false); state.talkUntil = 0; clearTimeout(talkTimer); if (state.running) setStatus('Running'); if (!speaker.current) idleMode(); }
async function cloudTalk() {
  try {
    const text = await cloud.listen({ onRecorded: () => setMode('Thinking') });
    if (!state.running) return;
    if (!text) { cues.play('huh'); endTalk(); say("I did not catch that. Tap the screen and try again.", 'status'); logEvent('talk-nothing', ''); return; }
    handleTranscript(text);
  } catch (e) {
    logEvent('cloud-stt-fail', e && e.message);
    endTalk();
    if (cloud.refused || (e && e.name === 'NotAllowedError')) {
      // The key is refused, or the microphone is blocked: a setup problem, not the signal. Only then switch over.
      cloudOff = true;
      say("Google listening is not working, so I will use the phone's own listening. Tap the screen and try again.", 'status');
      startListening();
    } else {
      // Signal: it was already tried twice. Google is used again on the next tap.
      say('I could not reach Google, the signal may be weak. Tap the screen and try again.', 'status');
    }
  }
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
  if (useCloud()) cloudTalk(); else if (!state.listening) startListening();
  setStatus('Listening'); setMode('Listening');
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    speaker.hold(false);
    if (!state.talkHeard && state.running) { cues.play('huh'); setStatus('Running'); logEvent('talk-timeout', ''); }
    if (!speaker.current) idleMode();
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
  const text = describeScene(state.scene.tracks, state.scene.w, { path: engine.free.advice(true) });
  logEvent('describe', text);
  say(text, 'status');
  state.lastSpoken = text;
}

// "Calibrate" (Package F): average the phone's tilt over 2 seconds, then ask the walker's height once.
let calibrating = false;
function calibrate() {
  if (calibrating) return;
  if (!('DeviceOrientationEvent' in window)) { say('This phone cannot tell me how it is tilted, so I cannot calibrate.', 'status'); return; }
  calibrating = true;
  say('Hold the phone at chest height, pointing straight ahead, and keep still.', 'status');
  setTimeout(() => calibrator.start(performance.now()), 3000);
  setTimeout(() => {
    calibrating = false;
    const pitch = calibrator.done();
    if (pitch == null) { say('I could not read the phone\'s tilt. Try again, or check the browser can use motion sensors.', 'status'); return; }
    floorCal.pitch = pitch; saveFloorCal(); logEvent('calibrate', JSON.stringify({ pitch }));
    const done = () => say(`Calibrated. The phone is tilted about ${Math.round(Math.abs(pitch))} degrees ${pitch >= 0 ? 'down' : 'up'}.`, 'status');
    if (floorCal.heightCm) { done(); return; }
    dialogue.askValue('How tall are you, in feet and inches or centimetres?', parseHeight, (cm) => {
      floorCal.heightCm = cm; saveFloorCal(); logEvent('height', String(cm)); done();
    }, 'Say your height, for example, 5 foot 8, or 172 centimetres.');
  }, 5200);
}

// ---------- recording a walk and following it again ----------
function startRouteRecording(rawName) {
  if (routeRecorder.active) { say('Already recording. Say stop recording when you have finished.', 'status'); return; }
  if (!('geolocation' in navigator)) { say('This phone cannot record a route.', 'status'); return; }
  const name = normaliseName(rawName) || 'my walk';
  routeRecorder.start(name); recAnnounced = 0;
  recWatch = navigator.geolocation.watchPosition((pos) => {
    feedHeading(pos);
    routeRecorder.add({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
    if (routeRecorder.metres - recAnnounced >= 200) { recAnnounced = routeRecorder.metres; say(`Still recording. ${roundMetres(routeRecorder.metres)} so far.`, 'status'); }
  }, () => say('I lost your location signal while recording.', 'status'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  logEvent('route-record', name);
  say(`Recording ${name}. Walk, and say stop recording when you have finished.`, 'status');
}

function stopRouteRecording() {
  if (!routeRecorder.active) { say('I am not recording a route.', 'status'); return null; }
  try { if (recWatch != null) navigator.geolocation.clearWatch(recWatch); } catch (_) { /* ignore */ }
  recWatch = null;
  const { name, points } = routeRecorder.stop(); const metres = pathLength(points);
  if (points.length < 2 || metres < 20) { say('That was too short to save as a route. Try again.', 'status'); return null; }
  const r = routes.save(name, points);
  logEvent('route-saved', `${name} ${Math.round(metres)}m ${points.length}pts`);
  say(`Saved route ${r.name}, ${roundMetres(metres)}.${r.persisted ? '' : ' I could not store it on this phone, so I will only remember it until you close the page.'} Say follow route ${r.name}, or take me back along route ${r.name}.`, 'status');
  return r;
}

async function followRoute(rawName, reverse) {
  if (routeRecorder.active) { if (!stopRouteRecording()) return; }
  const rec = rawName ? routes.get(rawName) : routes.getLast();
  if (!rec) { say(rawName ? `I do not have a route called ${rawName}. Say what routes do I have.` : 'I have no recorded route to go back along. Say record a route first.', 'status'); return; }
  let pos;
  try { pos = await navigator_.getPosition(); } catch (e) { say(locationMessage(e), 'status'); return; }
  const route = routeFromPoints(rec.points, rec.name, { reverse });
  if (!route) { say('That route is too short to follow.', 'status'); return; }
  const gap = haversine(pos, route.start);
  if (gap > 80) { say(`You are ${roundMetres(gap)} from the ${reverse ? 'end' : 'start'} of route ${rec.name}, so I cannot follow it from here. Go to its ${reverse ? 'end' : 'start'} first.`, 'status'); return; }
  const dest = { name: `the ${reverse ? 'start' : 'end'} of route ${rec.name}`, lat: route.end.lat, lon: route.end.lon, large: false };
  logEvent('route-follow', `${rec.name}${reverse ? ' reversed' : ''}`);
  navigator_.begin(pos, dest, route, true, false);
}

// "vibration on/off" (older command) maps onto the output modes.
function changeVibration(on, speak = true) { setOutput(on ? 'both' : 'speech', speak); }
function setOutput(mode, speak = true) {
  if (!OUTPUT_MODES.includes(mode)) return;
  out.mode = mode;
  haptics.set(mode !== 'speech');
  cues.vibrate = mode === 'speech' ? null : cues.vibrateFn;
  el.output.textContent = `Output: ${OUTPUT_NAMES[mode]}`;
  try { localStorage.setItem('va.output', mode); } catch (_) { /* storage can be unavailable */ }
  logEvent('output', mode);
  if (!speak) return;
  if (mode !== 'speech' && !haptics.available) { say(`${outputText(mode)} But this phone or browser cannot vibrate.`, 'status'); return; }
  if (mode !== 'speech') haptics.buzz('obstacle');
  say(outputText(mode), 'status');
}
function setScreenReader(on, speak = true) {
  out.screenReader = !!on;
  el.sr.setAttribute('aria-pressed', String(!!on));
  el.sr.textContent = `Screen reader mode: ${on ? 'on' : 'off'}`;
  try { localStorage.setItem('va.sr', on ? '1' : '0'); } catch (_) { /* storage can be unavailable */ }
  logEvent('screen-reader', on ? 'on' : 'off');
  if (speak) say(on ? 'Screen reader mode on. Your screen reader will read my answers. I will still speak warnings and turns myself.' : 'Screen reader mode off. I will speak everything myself.', 'status');
}

function changeRate(dir) {
  const next = stepRate(speaker.rate, dir);
  if (next == null) { say(dir < 0 ? 'That is already the slowest I speak.' : 'That is already the fastest I speak.', 'status'); return; }
  speaker.rate = next;
  try { localStorage.setItem('va.rate', String(next)); } catch (_) { /* storage can be unavailable */ }
  if (el.rate) el.rate.textContent = `Speech speed: ${Math.round(next * 100)}%`;
  logEvent('rate', String(next));
  say(dir < 0 ? 'Okay, slower. Like this.' : 'Okay, faster. Like this.', 'status');
}

// Sharing needs a real tap (the browser will not open the share sheet from a voice command), so the command
// gets the location ready and the next tap on the empty screen opens the share sheet.
let pendingShare = null;
// "Describe this": one photo to Google for a fuller description (things and their side, the kind of place, a logo, writing).
// Without Google (no internet, key not allowed), the phone's own description is given instead.
let looking = false;
async function lookNow() {
  if (looking) return;
  if (!state.running || !stream || !el.video.videoWidth) { say(NO_CAMERA, 'status'); return; }
  if (!vision || !vision.usable) { describeNow(); return; }
  looking = true;
  try {
    say('Looking.', 'status');
    const { base64 } = frameToBase64(el.video);
    const text = sceneSpeech(await vision.annotate(base64, 'look'));
    logEvent('look', text);
    say(text, 'status'); state.lastSpoken = text;
  } catch (e) {
    logEvent('look-error', e && e.message);
    say('I could not reach Google, so this is what I can see on the phone.', 'status');
    describeNow();
  } finally { looking = false; }
}

// "What is near me", "is there a cafe nearby": shops and places from the map, nearest first, with the side when known.
async function nearbyNow(query = null) {
  if (!GOOGLE_KEY) { say('I cannot look up places on this version.', 'status'); return; }
  let pos;
  try { pos = await navigator_.getPosition(); } catch (e) { say(locationMessage(e), 'status'); return; }
  try {
    const list = await searchNearby(pos, { key: GOOGLE_KEY, query });
    const text = nearbySpeech(list, pos, { heading: walkHeading.get(), query });
    logEvent('nearby', text);
    say(text, 'status'); state.lastSpoken = text;
  } catch (e) {
    logEvent('nearby-error', e && e.message);
    say('I could not look up places near you. Check your internet connection.', 'status');
  }
}

async function prepareShare() {
  let pos;
  try { pos = await navigator_.getPosition(); } catch (e) { say(locationMessage(e, 'I cannot find your location to share.'), 'status'); return; }
  const where = await reverseLookup(pos).then((j) => describePlace(j).replace(/^You are /, 'I am ')).catch(() => '');
  pendingShare = `${where ? where + ' ' : ''}My location: https://www.google.com/maps?q=${pos.lat.toFixed(6)},${pos.lon.toFixed(6)} (accurate to about ${Math.round(pos.accuracy)} metres)`;
  logEvent('share-ready', '');
  say('Your location is ready to send. Tap the screen, then choose who to send it to.', 'status');
}
async function doShare() {
  const text = pendingShare; pendingShare = null;
  try {
    if (navigator.share) { await navigator.share({ text }); logEvent('share', 'shared'); }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(text); say('I have copied your location. Paste it into a message.', 'status'); }
    else say('I cannot share from this browser.', 'status');
  } catch (e) { if (!e || e.name !== 'AbortError') say('I could not share your location.', 'status'); }
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
  // Recording needs a spoken (or tapped) yes first, once per page session. Nothing is recorded until then.
  if (on && !consent.granted) {
    consent.request((q, yes, no) => dialogue.confirm(q, yes, no), () => setRecording(true, speak),
      () => { logEvent('record-refused', ''); say('Okay. Recording stays off.', 'status'); });
    return;
  }
  if (on && !RECORD) logEvent('record-consent', '');
  RECORD = on;
  if (state.running) { if (on) startRecording(); else stopRecording(); }
  el.rec.setAttribute('aria-pressed', String(on));
  el.rec.textContent = `Record session: ${on ? 'on' : 'off'}`;
  el.saveRec.hidden = !on;
  if (speak) say(on ? (state.running ? 'Recording now.' : 'Recording is on. It starts when you tap start.') : 'Recording is off.', 'status');
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
  const recent = speaker.busy() || Date.now() - speaker.lastEnd < 5000; // the recogniser can be several seconds behind
  if (!recent) return false;
  return looksLikeEcho(text, spokenHistory.map((h) => h.text));
}

// The walker starts talking over the app: stop speaking and listen (like tapping Talk), without waiting for them to finish.
function bargeIn(text) {
  if (!state.running || performance.now() < state.talkUntil) return;
  const cur = speaker.current;
  if (!cur || cur.kind === 'urgent') return; // only interrupt when we are speaking, and never a danger warning
  const answering = dialogue.waiting && parseAnswer(text).type;
  const isCommand = !!parseCommand(text).type;
  if (!isBargeIn(text, spokenHistory.map((h) => h.text), { isAnswer: !!answering, isCommand })) return;
  logEvent('barge-in', text);
  if (dialogue.waiting) speaker.skip(); else speaker.hush(); // an answer means stop reading the question; otherwise say it again later
  speaker.hold(true);
  state.talkUntil = performance.now() + TALK_WINDOW_MS;
  state.talkHeard = false;
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => { speaker.hold(false); }, TALK_WINDOW_MS);
}

function handleTranscript(text) {
  logEvent('heard', text);
  const inTalk = performance.now() < state.talkUntil;
  const answering = dialogue.waiting && (dialogue.state === 'where' || dialogue.state === 'value' || !!parseAnswer(text).type); // an answer to our question always counts, even over our own voice
  if (!inTalk && !answering && isEcho(text)) { logEvent('ignored-echo', text); return; }
  addConvo('You', text);
  if (answering) speaker.skip(); // stop reading the question out
  if (inTalk) { setTimeout(() => speaker.hold(false), 150); /* after the command's own reply is queued, so the answer comes first */ state.talkHeard = true; state.talkUntil = 0; clearTimeout(talkTimer); if (state.running) setStatus('Running'); }
  if (dialogue.answer(text)) { cues.play('ok'); return; } // an answer to a question we asked
  const cmd = parseCommand(text);
  if (['navigate', 'saveAddress', 'whereami', 'lost', 'read', 'look', 'nearby'].includes(cmd.type)) setMode('Thinking'); // these wait on the network or a model
  if (cmd.type) cues.play('ok'); else if (inTalk) cues.play('huh');
  switch (cmd.type) {
    case 'describe': describeNow(); break;
    case 'look': lookNow(); break;
    case 'nearby': nearbyNow(cmd.arg || null); break;
    case 'whereami': whereAmI(); break;
    case 'save': savePlace(cmd.arg); break;
    case 'cross': say(state.running && state.scene ? crossingAdvice(state.scene.tracks) : CROSSING_TEXT, 'status'); break; // never a colour, never "safe"
    case 'limits': say(LIMITS_TEXT, 'status'); state.lastSpoken = LIMITS_TEXT; break;
    case 'calibrate': calibrate(); break;
    case 'privacy': say(PRIVACY_TEXT, 'status'); state.lastSpoken = PRIVACY_TEXT; break;
    case 'walkSummary': { const t = summaryText(walk.summary(Date.now())); say(t, 'status'); state.lastSpoken = t; break; }
    case 'noteAdd': { const r = notes.add(cmd.arg); say(r ? `Noted: ${r.text}.${r.persisted ? '' : ' I could only keep it until you close the page.'}` : 'What should I remember?', 'status'); break; }
    case 'noteList': { const l = notes.list().slice(-3).reverse(); say(l.length ? `Your latest notes: ${l.map((n) => n.text).join('. ')}.` : 'You have no notes yet. Say remember, then what to remember.', 'status'); break; }
    case 'noteFind': { const f = notes.find(cmd.arg); say(f.length ? `You told me: ${f[0].text}.` : 'I have no note about that.', 'status'); break; }
    case 'units': changeUnits(cmd.arg); break;
    case 'stepLength': changeStep(cmd.arg); break;
    case 'saveAddress': dialogue.saveAddress(cmd.name, cmd.arg); break;
    case 'routeRecord': startRouteRecording(cmd.arg); break;
    case 'routeStop': stopRouteRecording(); break;
    case 'routeFollow': followRoute(cmd.arg, cmd.reverse); break;
    case 'routeList': { const n = routes.list(); say(n.length ? `You have ${n.length} ${n.length === 1 ? 'route' : 'routes'}: ${n.join(', ')}.` : 'You have no recorded routes. Say record a route, to start one.', 'status'); break; }
    case 'vibration': changeVibration(cmd.arg === 'on'); break;
    case 'output': setOutput(cmd.arg); break;
    case 'screenReader': setScreenReader(cmd.arg === 'on'); break;
    case 'rate': changeRate(cmd.arg === 'slower' ? -1 : 1); break;
    case 'share': prepareShare(); break;
    case 'find': if (!state.running || !state.scene) say(NO_CAMERA, 'status');
      else say(findObject(state.scene.tracks, cmd.arg, state.scene.w, { extra: hazard.t && performance.now() - hazard.t < HAZARD.maxAgeMs ? hazard.dets : [] }), 'status'); break;
    case 'navinfo': say(navigator_.status(cmd.arg), 'status'); break;
    case 'wrong': logEvent('wrong-alert', state.lastAlertText || ''); say(state.lastAlertText ? 'Thank you. I have noted that the last warning was wrong.' : 'Thank you. There was no recent warning to note.', 'status'); break;
    case 'lost': (async () => { await whereAmI(); say('Stay where you are if it is not safe to move. Say take me home, or navigate to a place, or share my location.', 'status'); })(); break;
    case 'battery': say(battery.ask(), 'status'); if (!batteryStarted) startBatteryWatch(); break;
    case 'level':
      if (cmd.arg === 'less') stepLevel(-1); else if (cmd.arg === 'more') stepLevel(1); else setLevel(cmd.arg, true, false);
      break;
    case 'start': start(); break;
    case 'stop': stop(); break;
    case 'repeat': repeat(); break;
    case 'why': say(explainAlert(state.lastAlert), 'status'); logEvent('why', state.lastAlertText || ''); break;
    case 'selfcheck': runSelfCheck(true); break;
    case 'read': readText(); break;
    case 'help': say(HELP_TEXT, 'status'); break;
    case 'cancel': if (!navigator_.cancel()) say('No navigation is active.', 'status'); break;
    case 'navigateAsk': dialogue.askWhere(); break;
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
  recognition.interimResults = true; // partial text lets us stop speaking as soon as the walker starts to talk
  recognition.lang = CONFIG.speechLang;
  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) handleTranscript(t); else bargeIn(t);
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
el.start.addEventListener('click', () => { cues.unlock(); if (state.running || state.starting) stop(); else start(); });
prefetchAssets();

// Ask for location as soon as the app opens, not later. A precise (high accuracy) request is what makes Chrome on Android
// offer "turn on device location"; it also shows the allow-location prompt straight away. Asked again when the walker
// comes back to the page (for example after switching location on in settings).
let locAsked = -1e9;
function askLocation() {
  if (!('geolocation' in navigator) || performance.now() - locAsked < 4000) return;
  locAsked = performance.now();
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => { window.__lastFix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, t: Date.now() }; feedHeading(p); if (state.locProblem) { state.locProblem = false; setStatus(state.running ? 'Running' : 'Ready. Tap start.'); } },
      (e) => {
        state.locProblem = true;
        logEvent('location-ask-error', String(e && e.code));
        if (e && e.code === 1) setStatus('Location is blocked. Allow location for this site in Chrome settings.');
        else if (e && e.code === 2) setStatus('Location is off. Turn on location on your phone.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  } catch (_) { /* best effort */ }
}
askLocation();
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.running) askLocation(); });
el.units.addEventListener('click', () => changeUnits(UNIT_MODES[(UNIT_MODES.indexOf(getUnits()) + 1) % UNIT_MODES.length]));
el.step.addEventListener('click', cycleStep);
el.output.addEventListener('click', () => setOutput(OUTPUT_MODES[(OUTPUT_MODES.indexOf(out.mode) + 1) % OUTPUT_MODES.length]));
el.sr.addEventListener('click', () => setScreenReader(!out.screenReader));
el.rate.addEventListener('click', () => changeRate(speaker.rate >= RATES.at(-1) ? -(RATES.length - 1) : 1)); // up a step, wrapping back to the slowest
el.shareBtn.addEventListener('click', prepareShare);
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
  if (pendingShare && !(e.target.closest && e.target.closest('button, input, summary, details, label, a, select, form'))) { doShare(); return; }
  if (!state.running || !state.tapToTalk) return;
  if (e.target.closest && e.target.closest('button, input, summary, details, label, a, select, form')) return;
  const now = performance.now();
  if (now - state.lastTapAt < 1500) return; // ignore bounces and pocket drumming
  state.lastTapAt = now;
  talk();
});
el.talk.addEventListener('click', () => { cues.unlock(); talk(); });
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
  el.rate.textContent = `Speech speed: ${Math.round(speaker.rate * 100)}%`;
  const rt = parseFloat(localStorage.getItem('va.rate')); if (rt >= RATES[0] && rt <= RATES.at(-1)) { speaker.rate = rt; el.rate.textContent = `Speech speed: ${Math.round(rt * 100)}%`; }
  const om = localStorage.getItem('va.output');
  if (OUTPUT_MODES.includes(om)) setOutput(om, false); else if (localStorage.getItem('va.haptics') === '0') setOutput('speech', false); // older setting
  if (localStorage.getItem('va.sr') === '1') setScreenReader(true, false);
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
