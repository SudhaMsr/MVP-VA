// On-demand text reading, entirely on the phone (no photo is sent anywhere, no paid service).
// 1) Chrome's built-in TextDetector when the phone offers it, 2) otherwise Tesseract.js (WebAssembly, loaded once).
// Pure helpers are exported for tests.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const clean = (s) => s.replace(/\s+/g, ' ').replace(/[|_~^<>{}\\]/g, ' ').trim();

// items: [{ text, size, conf }]  (size = box area or text height; conf 0..1 or null when the engine gives none)
// Returns { pieces: [string], confidence: 0..1 } with the most prominent (largest) text first.
export function pickText(items) {
  const good = [];
  for (const it of items) {
    const text = clean(it.text || '');
    if (text.length < 2 || !/[A-Za-z0-9]{2}/.test(text)) continue;
    // mostly-symbol results are usually noise
    const letters = (text.match(/[A-Za-z0-9]/g) || []).length;
    if (letters / text.length < 0.6) continue;
    if (it.conf != null && it.conf < 0.35) continue;
    good.push({ text, size: it.size || 0, conf: it.conf ?? 0.8 });
  }
  good.sort((a, b) => b.size - a.size);
  const seen = new Set();
  const top = good.filter((b) => { const k = b.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  const confidence = top.length ? top.reduce((s, b) => s + b.conf, 0) / top.length : 0;
  return { pieces: top.map((b) => b.text), confidence };
}

// What to say. Honest about uncertainty; short.
export function readingSpeech({ pieces, confidence }) {
  if (!pieces.length) return "I can't read any text. Try moving closer, or hold the phone steady and say read again.";
  const clip = (t) => (t.length > 110 ? t.slice(0, 107) + '...' : t);
  const body = pieces.map(clip).join('. ');
  if (confidence < 0.65) return `I am not sure, but it may say: ${body}.`;
  return `It says: ${body}.`;
}

let worker = null;
function loadScript(url) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = url; s.onload = () => res(); s.onerror = () => rej(new Error('could not load reader'));
    document.head.appendChild(s);
  });
}

export function hasBuiltIn() { return typeof window !== 'undefined' && 'TextDetector' in window; }

// canvas -> { pieces, confidence, engine }
export async function recogniseText(canvas, { onLoading = () => {} } = {}) {
  if (hasBuiltIn()) {
    try {
      const found = await new window.TextDetector().detect(canvas);
      const items = found.map((f) => ({ text: f.rawValue, size: (f.boundingBox?.width || 0) * (f.boundingBox?.height || 0), conf: null }));
      const r = pickText(items);
      if (r.pieces.length) return { ...r, engine: 'built-in' };
    } catch (_) { /* fall through to Tesseract */ }
  }
  if (!worker) {
    onLoading();
    await loadScript(TESSERACT_URL);
    worker = await window.Tesseract.createWorker('eng');
  }
  const { data } = await worker.recognize(canvas);
  const items = (data.lines || []).map((l) => ({
    text: l.text, conf: (l.confidence ?? 0) / 100,
    size: Math.max(1, (l.bbox.y1 - l.bbox.y0)) * Math.max(1, (l.bbox.x1 - l.bbox.x0)),
  }));
  return { ...pickText(items), engine: 'tesseract' };
}
