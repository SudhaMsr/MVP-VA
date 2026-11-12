// Google Cloud Vision, on request only (12 Nov): "read" reads signs, shop names, door numbers and letters; "describe this"
// says what the picture shows (things and which side they are on, the kind of place, a shop logo, the largest text).
// One photo is sent to Google each time the walker asks, and never otherwise. When Google cannot be used (no internet,
// key not allowed), the caller falls back to reading and describing on the phone.
import { pickText } from './reader.js';

export const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

export function buildVisionRequest(base64Jpeg, kind = 'read') {
  const features = kind === 'look'
    ? [{ type: 'OBJECT_LOCALIZATION', maxResults: 10 }, { type: 'LABEL_DETECTION', maxResults: 10 }, { type: 'LOGO_DETECTION', maxResults: 3 }, { type: 'TEXT_DETECTION' }]
    : [{ type: 'TEXT_DETECTION' }];
  return { requests: [{ image: { content: base64Jpeg }, features, imageContext: { languageHints: ['en'] } }] };
}

const BREAKS = new Set(['SPACE', 'SURE_SPACE', 'EOL_SURE_SPACE', 'LINE_BREAK', 'HYPHEN']);
const area = (poly) => {
  const v = (poly && (poly.vertices || poly.normalizedVertices)) || [];
  if (v.length < 3) return 0;
  const xs = v.map((p) => p.x || 0); const ys = v.map((p) => p.y || 0);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

// Text blocks (a sign, a line of a letter) with their size on the picture, biggest first after pickText.
export function textItems(resp) {
  const pages = (resp && resp.fullTextAnnotation && resp.fullTextAnnotation.pages) || [];
  const items = [];
  for (const page of pages) for (const block of page.blocks || []) {
    const text = (block.paragraphs || []).map((p) => (p.words || []).map((w) => (w.symbols || []).map((s) => {
      const br = s.property && s.property.detectedBreak && s.property.detectedBreak.type;
      return s.text + (br && BREAKS.has(br) ? ' ' : '');
    }).join('')).join('')).join(' ');
    items.push({ text, size: area(block.boundingBox), conf: typeof block.confidence === 'number' && block.confidence > 0 ? block.confidence : null });
  }
  if (!items.length && resp && Array.isArray(resp.textAnnotations) && resp.textAnnotations[0]) {
    for (const line of String(resp.textAnnotations[0].description || '').split('\n')) items.push({ text: line, size: 1, conf: null });
  }
  return items;
}

// { pieces, confidence, engine } like reader.js recogniseText, so readingSpeech words it the same way.
export function parseRead(resp) { return { ...pickText(textItems(resp)), engine: 'google' }; }

// Where an object is in the picture, from its normalised box (0 left .. 1 right).
export function sideOfBox(poly) {
  const v = (poly && poly.normalizedVertices) || [];
  if (!v.length) return null;
  const xs = v.map((p) => p.x || 0);
  const c = (Math.min(...xs) + Math.max(...xs)) / 2;
  return c < 0.36 ? 'on the left' : c > 0.64 ? 'on the right' : 'ahead';
}

// Labels that say nothing useful to someone who cannot see the picture.
const DULL = new Set(['sky', 'font', 'rectangle', 'line', 'tints and shades', 'material property', 'pattern', 'symmetry', 'parallel',
  'circle', 'triangle', 'electric blue', 'darkness', 'black', 'white', 'grey', 'colorfulness', 'magenta', 'azure', 'number', 'brand',
  'logo', 'signage', 'graphics', 'art', 'event', 'photography', 'snapshot', 'monochrome', 'monochrome photography', 'black-and-white',
  'style', 'shade', 'composite material', 'cloud', 'atmosphere', 'happy', 'gesture', 'fun', 'leisure']);
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// What to say for "describe this". Honest: always "I think" / "may say", never that anything is clear or safe.
export function sceneSpeech(resp, { maxObjects = 4, maxLabels = 3 } = {}) {
  const objs = [];
  for (const o of (resp && resp.localizedObjectAnnotations) || []) {
    if ((o.score || 0) < 0.6) continue;
    const name = String(o.name || '').toLowerCase();
    if (name) objs.push({ name, side: sideOfBox(o.boundingPoly) });
  }
  // two people on the left, not "a person on the left, a person on the left"
  const grouped = [];
  for (const o of objs) {
    const g = grouped.find((x) => x.name === o.name && x.side === o.side);
    if (g) g.n += 1; else grouped.push({ ...o, n: 1 });
  }
  const objText = grouped.slice(0, maxObjects).map((o) => {
    const name = o.n > 1 ? (o.name === 'person' ? 'people' : `${o.name}s`) : `${article(o.name)} ${o.name}`;
    return `${o.n > 1 ? `${o.n} ` : ''}${name}${o.side ? ` ${o.side}` : ''}`;
  });
  const named = new Set(objs.map((o) => o.name));
  const labels = ((resp && resp.labelAnnotations) || [])
    .filter((l) => (l.score || 0) >= 0.72)
    .map((l) => String(l.description || '').toLowerCase())
    .filter((l) => l && !DULL.has(l) && !named.has(l) && !named.has(l.replace(/s$/, '')))
    .slice(0, maxLabels);
  const logo = ((resp && resp.logoAnnotations) || []).find((l) => (l.score || 0) >= 0.6);
  const read = pickText(textItems(resp));
  const parts = [];
  if (objText.length) parts.push(`I think I can see ${listWords(objText)}.`);
  if (labels.length) parts.push(`It looks like ${listWords(labels)}.`);
  if (logo) parts.push(`The logo looks like ${logo.description}.`);
  if (read.pieces.length) {
    const t = read.pieces.slice(0, 2).map((p) => (p.length > 80 ? `${p.slice(0, 77)}...` : p)).join('. ');
    parts.push(`${read.confidence < 0.65 ? 'Some writing may say' : 'Writing says'}: ${t}.`);
  }
  if (!parts.length) return 'I could not make out what is in front of you. Hold the phone steady and ask again.';
  return parts.join(' ');
}

// One picture from the camera, at most 1024 pixels on the long side, as base64 JPEG.
export function frameToBase64(video, doc = document, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const c = doc.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return { canvas: c, base64: c.toDataURL('image/jpeg', 0.85).split(',')[1] || '' };
}

export class CloudVision {
  constructor({ key, fetchFn = (...a) => fetch(...a), log = () => {}, timeoutMs = 9000 } = {}) {
    Object.assign(this, { key, fetchFn, log, timeoutMs });
    this.refused = false;
  }

  get usable() { return !!(this.key && !this.refused); }

  // kind: 'read' or 'look'. Resolves to Google's answer for the one picture; throws when Google cannot be used.
  async annotate(base64Jpeg, kind = 'read') {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
    const t0 = Date.now();
    let res;
    try {
      res = await this.fetchFn(`${VISION_URL}?key=${encodeURIComponent(this.key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildVisionRequest(base64Jpeg, kind)), signal: ctl ? ctl.signal : undefined,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) this.refused = true; // key not allowed for Vision: use the phone from now on
      const body = await res.text().catch(() => '');
      this.log('vision-error', `${res.status} ${body.slice(0, 160)}`);
      throw new Error(`vision ${res.status}`);
    }
    const j = await res.json();
    const r = (j.responses && j.responses[0]) || {};
    if (r.error) { this.log('vision-error', String(r.error.message || '').slice(0, 160)); throw new Error('vision answer error'); }
    this.log('vision-ok', `${kind} ${Date.now() - t0} ms`);
    return r;
  }
}
