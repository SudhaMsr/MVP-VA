// Ask Gemini (20 Nov): the fallback brain. When the walker taps Talk and says something no voice command matches
// ("what colour is this jumper?", "is this the 73 bus?", "what can I do about a wet pavement?"), the words go to Google
// Gemini, with one camera photo when the question is about what is in front of them, and the short answer is spoken.
// Fixed commands, hazard warnings, vehicle alerts and directions never go through Gemini and are never slowed by it.
// Every answer is checked before it is spoken: anything that implies safety, reads a traffic signal, or uses compass
// words is replaced (see safeAnswer). Uses the same referrer-restricted Google key, which needs the Generative Language API.
import { bannedIn, CROSSING_TEXT } from './safetext.js';

export const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

// The rules Gemini is given. Worded without the banned phrases themselves (tests/safetext.test.js scans every string).
export const SYSTEM_TEXT = [
  'You are Vision Assist, a calm voice helper for a blind or low-vision person who is often walking outside in the UK.',
  'Your answer is read aloud by a phone. Use plain British English, one to three short sentences, under 45 words. No lists, no markdown, no emoji.',
  'If a photo is attached it is from a phone held at chest height facing forward. Say only what you can actually see, use left, right and ahead, and say "I think" when unsure.',
  'Never tell the person that crossing, walking or moving is free of danger. You cannot read traffic lights or pedestrian signals: if asked, say you cannot read the signal and they should listen for traffic.',
  'You cannot reliably see kerbs, steps, drops, potholes, low branches or ice. For anything underfoot, tell them to check with their cane or guide dog.',
  'Never use compass directions such as north or south-west. Give distances in steps, one step is about 70 centimetres.',
  'You cannot start navigation or change settings. If they want that, tell them the exact words to say, for example: say navigate to, then the place.',
  'If you do not know, say so briefly.',
].join(' ');

// Questions about what the camera shows get a photo; others (general knowledge, advice) are sent as words only.
const VISUAL = /\b(?:see|seeing|look|looks|looking|this|that|these|those|here|front|ahead|colou?r|wearing|holding|sign|label|screen|bus|number|door|shop|logo|picture|photo|camera|read|written|say|says|expiry|date|price|which way|left|right|in my hand|is it|is there|are there|what's|what is|how many|describe)\b/;
export function needsPhoto(question) { return VISUAL.test(String(question || '').toLowerCase()); }

// The request body. history: earlier turns [{ q, a }] (oldest first, at most the last 3 are kept; never with photos).
export function buildGeminiRequest({ question, base64Jpeg = '', context = '', history = [] }) {
  const contents = [];
  for (const h of history.slice(-3)) {
    contents.push({ role: 'user', parts: [{ text: h.q }] });
    contents.push({ role: 'model', parts: [{ text: h.a }] });
  }
  const parts = [];
  if (base64Jpeg) parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } });
  parts.push({ text: context ? `What the app knows now: ${context}\n\nThe person asks: ${question}` : question });
  contents.push({ role: 'user', parts });
  return {
    systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
    contents,
    generationConfig: { maxOutputTokens: 160, temperature: 0.3 },
    safetySettings: [],
  };
}

// The answer text from Gemini's reply ('' when there is none).
export function answerText(resp) {
  const c = resp && Array.isArray(resp.candidates) && resp.candidates[0];
  const parts = (c && c.content && c.content.parts) || [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(' ').trim();
}

const SIGNAL = /\b(?:(?:green|red|amber)\s+(?:light|man|signal|figure)|(?:light|signal|man)\s+(?:is|looks|turned|has turned|shows)\s+(?:green|red|amber)|(?:it|the light) is (?:green|red))\b/i;
const COMPASS = /\b(?:north|south|east|west)(?:[- ]?(?:east|west))?(?:ern|wards?)?\b/i;
export const UNSURE_TEXT = 'I am not sure. Please check with your cane or ask someone nearby.';
export const NO_ANSWER_TEXT = 'I do not have an answer for that. Try asking another way, or say help to hear what I can do.';

// What may be spoken: plain text, short, and nothing that implies safety, reads a signal, or uses compass words.
export function safeAnswer(raw, maxChars = 320) {
  let t = String(raw || '')
    .replace(/[*_#`>]+/g, ' ')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return NO_ANSWER_TEXT;
  if (SIGNAL.test(t)) return CROSSING_TEXT;
  if (bannedIn(t).length) return UNSURE_TEXT;
  // Drop sentences with compass words rather than the whole answer.
  const sentences = t.match(/[^.!?]+[.!?]*/g) || [t];
  const kept = sentences.filter((s) => !COMPASS.test(s)).map((s) => s.trim()).filter(Boolean);
  if (!kept.length) return UNSURE_TEXT;
  t = '';
  for (const s of kept) { if (t && (t + ' ' + s).length > maxChars) break; t = t ? `${t} ${s}` : s; }
  if (t.length > maxChars) t = `${t.slice(0, maxChars).replace(/\s+\S*$/, '')}.`;
  return t;
}

export class GeminiChat {
  constructor({ key, model, fetchFn = (...a) => fetch(...a), log = () => {}, timeoutMs = 12000, now = () => Date.now() } = {}) {
    Object.assign(this, { key, model, fetchFn, log, timeoutMs, now });
    this.refused = false; // the key is not allowed to use Gemini: stop trying until the page is reloaded
    this.history = [];
    this.lastAt = 0;
  }

  get usable() { return !!(this.key && this.model && !this.refused); }

  // A short memory of the conversation, forgotten after 3 minutes of not asking.
  recentHistory() { return this.now() - this.lastAt > 180000 ? [] : this.history; }

  // Resolves to the answer to speak (already through safeAnswer). Throws when Gemini cannot be reached or is refused.
  async ask(question, { base64Jpeg = '', context = '' } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), this.timeoutMs);
    const t0 = this.now();
    let res;
    try {
      res = await this.fetchFn(`${GEMINI_URL(this.model)}?key=${encodeURIComponent(this.key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiRequest({ question, base64Jpeg, context, history: this.recentHistory() })),
        signal: ctl ? ctl.signal : undefined,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) this.refused = true;
      const body = await res.text().catch(() => '');
      this.log('gemini-error', `${res.status} ${body.slice(0, 160)}`);
      const err = new Error(`gemini ${res.status}`); err.status = res.status; throw err;
    }
    const raw = answerText(await res.json());
    const answer = safeAnswer(raw);
    if (raw && answer !== raw) this.log('gemini-filtered', raw.slice(0, 200));
    this.log('gemini-ok', `${base64Jpeg ? 'photo' : 'words'} ${this.now() - t0} ms`);
    this.history = [...this.recentHistory(), { q: question, a: answer }].slice(-3);
    this.lastAt = this.now();
    return answer;
  }
}
