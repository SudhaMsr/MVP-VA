// On-demand text reading: one photo -> Google Cloud Vision text detection -> short spoken result.
// Pure helpers are exported for tests. Photos are sent to Google only when the walker asks (and has agreed once).

export async function callVision(base64Jpeg, key, fetchFn = (...a) => fetch(...a)) {
  const res = await fetchFn('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content: base64Jpeg }, features: [{ type: 'TEXT_DETECTION' }], imageContext: { languageHints: ['en'] } }] }),
  });
  if (!res.ok) throw new Error('vision ' + res.status);
  const j = await res.json();
  const r = j.responses && j.responses[0];
  if (r && r.error) throw new Error('vision ' + (r.error.message || r.error.code));
  return r || {};
}

const area = (poly) => {
  const v = poly?.vertices || [];
  if (v.length < 3) return 0;
  const xs = v.map((p) => p.x || 0), ys = v.map((p) => p.y || 0);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

const clean = (s) => s.replace(/\s+/g, ' ').replace(/[|_~^<>{}\\]/g, ' ').trim();

// Returns { pieces: [string], confidence: 0..1 } with the most prominent (largest) text first.
export function parseVision(resp) {
  const blocks = [];
  for (const page of resp?.fullTextAnnotation?.pages || []) {
    for (const b of page.blocks || []) {
      const words = [];
      for (const p of b.paragraphs || []) {
        for (const w of p.words || []) words.push((w.symbols || []).map((s) => s.text).join(''));
      }
      const text = clean(words.join(' '));
      if (text.length >= 2 && /[A-Za-z0-9]/.test(text)) blocks.push({ text, size: area(b.boundingBox), conf: b.confidence ?? 0.8 });
    }
  }
  blocks.sort((a, b) => b.size - a.size);
  const seen = new Set();
  const top = blocks.filter((b) => { const k = b.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  const confidence = top.length ? top.reduce((s, b) => s + b.conf, 0) / top.length : 0;
  return { pieces: top.map((b) => b.text), confidence };
}

// What to say. Honest about uncertainty; short.
export function readingSpeech({ pieces, confidence }) {
  if (!pieces.length) return "I can't read any text. Try moving closer, or hold the phone steady and say read again.";
  const clip = (t) => (t.length > 110 ? t.slice(0, 107) + '...' : t);
  const body = pieces.map(clip).join('. ');
  if (confidence < 0.6) return `I am not sure, but it may say: ${body}.`;
  return `It says: ${body}.`;
}

export const READ_NOTICE =
  'Reading sends one photo to Google to find the words. The photo is not kept by this app. Say read again, or tap Read, to go ahead.';
