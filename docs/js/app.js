// Vision Assist - app wiring: camera, detection loop, speech, voice commands, error handling.
// Rule for this file: every failure is spoken. No silent states.
import { CONFIG, MODELS, DEFAULT_MODEL, SECONDARY } from './config.js';
import { filterAllowed, mergeLanes } from './lanes.js';
import { Detector } from './detector.js';
import { Tracker } from './tracker.js';
import { AlertEngine } from './alerts.js';
import { Speaker } from './speech.js';
import { parseCommand, HELP_TEXT } from './commands.js';

const params = new URLSearchParams(location.search);
const SIZE = params.get('size') === '416' ? 416 : CONFIG.inputSize;
const MODEL_KEY = MODELS[params.get('model')] ? params.get('model') : DEFAULT_MODEL;
const MODEL = MODELS[MODEL_KEY];
const DEBUG = params.has('debug');
const EP = params.get('ep') || 'wasm';

const $ = (id) => document.getElementById(id);
const el = {
  start: $('startBtn'), stop: $('stopBtn'), repeat: $('repeatBtn'), mic: $('micBtn'),
  status: $('status'), last: $('lastAlert'), stats: $('stats'), video: $('video'), overlay: $('overlay'),
  dl: $('logBtn'),
};

const FULL_DISCLAIMER =
  'Vision Assist is a test prototype. It can miss obstacles and can be wrong. ' +
  'Always use your cane or guide dog as well. Starting now.';

const speaker = new Speaker(window.speechSynthesis, window.SpeechSynthesisUtterance, {
  rate: CONFIG.speechRate, lang: CONFIG.speechLang, staleMs: CONFIG.staleMs,
});
const tracker = new Tracker();
const engine = new AlertEngine();
let detector = null;
let slowDetector = null; // second model for stairs, manholes, benches...
const slow = { dets: [], t: null };
let frameCount = 0;
const USE_SLOW = params.get('lane') !== 'off' && MODEL_KEY !== SECONDARY.model;
let stream = null;
let recognition = null;
let wakeLock = null;

const state = {
  running: false, starting: false, listening: false, firstRun: true, wasRunning: false,
  lastSpoken: '', lastSpeechAt: performance.now(), lastFrameOk: 0, errors: 0, timer: null,
  lastWarnAt: 0,
};
const frameTimes = [];
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
    if (slowDetector && frameCount % SECONDARY.everyNFrames === 0) {
      try {
        const r = await slowDetector.detect(el.video, SECONDARY.conf, CONFIG.nmsIou);
        slow.dets = filterAllowed(r.dets, SECONDARY.classes);
        slow.t = performance.now();
      } catch (e) { logEvent('slow-frame-error', e && e.message); }
      if (!state.running) return;
    }
    const t = performance.now();
    const dets = mergeLanes(fast, slow, t, SECONDARY.maxAgeMs);
    const tracks = tracker.update(dets, t, width);
    const alert = engine.next(tracks, width, height, t);
    if (alert) {
      speaker.speak(alert.text, alert.urgent ? 'urgent' : 'normal');
      logEvent('alert', `${alert.priority}|${alert.text}`);
    }
    if (DEBUG) drawOverlay(tracks, width, height);
    const ms = performance.now() - t0;
    frameTimes.push(ms);
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
    `(${(1000 / med).toFixed(1)} frames/s). Model ${MODEL_KEY} ${SIZE}px${slowDetector ? ' + stairs lane' : ''}, ${EP}.`;
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

// ---------- health checks ----------
setInterval(() => {
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
  setStatus('Starting');
  say(state.firstRun ? FULL_DISCLAIMER : 'Starting.', 'status');
  startListening(); // inside the tap, so the browser allows the microphone prompt
  try {
    await openCamera();
  } catch (e) {
    logEvent('camera-error', e && e.name);
    say(cameraErrorText(e), 'status');
    setStatus('Camera problem. Tap start to retry.');
    state.starting = false;
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
    return;
  }
  state.firstRun = false;
  state.running = true;
  state.starting = false;
  state.errors = 0;
  state.lastFrameOk = performance.now();
  tracker.tracks = [];
  slow.dets = []; slow.t = null; frameCount = 0;
  engine.reset();
  setStatus('Running');
  say('Vision Assist active. Detecting obstacles.', 'status');
  lockScreen();
  loop();
}

function stopInternal() {
  state.running = false;
  state.starting = false;
  if (state.timer) clearTimeout(state.timer);
  stopCamera();
  releaseScreen();
  try { const c = el.overlay; c.getContext('2d').clearRect(0, 0, c.width, c.height); } catch (_) { /* ignore */ }
  setStatus('Stopped');
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
  if (isEcho(text)) { logEvent('ignored-echo', text); return; }
  const cmd = parseCommand(text);
  switch (cmd.type) {
    case 'start': start(); break;
    case 'stop': stop(); break;
    case 'repeat': repeat(); break;
    case 'help': say(HELP_TEXT, 'status'); break;
    case 'cancel': say('No navigation is active.', 'status'); break;
    case 'navigate':
      say(`Navigation is not in this test build yet. I heard: navigate to ${cmd.arg}.`, 'status');
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
el.start.addEventListener('click', start);
el.stop.addEventListener('click', stop);
el.repeat.addEventListener('click', repeat);
el.mic.addEventListener('click', () => {
  if (state.listening) { stopListening(); say('Voice commands off.', 'status'); }
  else { startListening(); say('Voice commands on. Say help for commands.', 'status'); }
});
el.dl.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ...session, frameMs: frameTimes, speech: speaker.log }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vision-assist-log-${Date.now()}.json`;
  a.click();
  say('Session log saved.', 'status');
});

if (DEBUG) document.body.classList.add('debug');
updateMic();
window.__va = { state, speaker, session, tracker, engine, start, stop };
