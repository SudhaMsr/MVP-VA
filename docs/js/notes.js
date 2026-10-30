// Spoken memory notes ("remember I put my keys in the drawer") and the crossing helper.
// Notes are kept on the phone only (localStorage). Pure logic, no browser needed.
export class NoteStore {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null), key = 'va.notes') { this.storage = storage; this.key = key; this.mem = []; }
  _load() { try { const r = this.storage && this.storage.getItem(this.key); if (r) return JSON.parse(r); } catch (_) { /* unavailable */ } return [...this.mem]; }
  add(text, now = Date.now()) {
    const t = String(text || '').trim().replace(/[.!?]+$/, '');
    if (!t) return null;
    const all = this._load(); all.push({ text: t, at: now }); const keep = all.slice(-30);
    this.mem = keep;
    let persisted = false;
    try { if (this.storage) { this.storage.setItem(this.key, JSON.stringify(keep)); persisted = true; } } catch (_) { /* memory only */ }
    return { text: t, persisted };
  }
  list() { return this._load(); }
  // Notes that mention the thing asked about, newest first. Words like "my" and "the" are ignored.
  find(query) {
    const words = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !['the', 'did', 'where', 'are', 'was', 'what', 'put', 'my', 'and'].includes(w));
    if (!words.length) return [];
    return this._load().filter((n) => words.some((w) => n.text.toLowerCase().includes(w))).reverse();
  }
  clear() { this.mem = []; try { if (this.storage) this.storage.removeItem(this.key); } catch (_) { /* ignore */ } }
}

// "Can I cross?" Honest and cautious: it reports what the camera sees and never says it is safe.
const MOVING = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'tricycle']);
export function crossingAdvice(tracks) {
  const seen = (tracks || []).filter((t) => (t.hits ?? 2) >= 2);
  const red = seen.some((t) => t.name === 'red_light'), green = seen.some((t) => t.name === 'green_light');
  const crossing = seen.some((t) => t.name === 'crosswalk');
  const vehicle = seen.find((t) => MOVING.has(t.name) && (t.dist == null || t.dist < 12));
  if (red) return 'The light looks red. Wait.';
  if (vehicle) return 'A vehicle is close. Wait and listen for traffic.';
  if (green) return 'The light looks green. I cannot be sure, so listen for traffic before you cross.';
  if (crossing) return 'I can see a crossing but no signal. Listen for traffic and cross only when you are sure.';
  return 'I cannot see a crossing or a signal. Do not rely on me to cross.';
}
