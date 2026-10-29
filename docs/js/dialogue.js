// Spoken conversation for navigation: asks which place when several match, tells the distance, and waits for "yes".
// Pure logic with injected dependencies, so it is tested without a browser.
import { roundMetres, minutesText, locationMessage, haversine } from './nav.js';

const YES = /^(yes|yeah|yep|yup|ok|okay|sure|go|go ahead|start|start now|correct|that is right|that's right|do it|please do)$/;
const NO = /^(no|nope|nah|cancel|stop|do not|don't|never mind|nevermind|wrong|not that one)$/;
const REPEAT = /^(repeat|repeat that|say that again|say again|again|what|pardon|sorry)$/;
const NUMBERS = { one: 1, first: 1, '1': 1, two: 2, second: 2, '2': 2, three: 3, third: 3, '3': 3 };

export function parseAnswer(raw) {
  if (!raw) return { type: null };
  const t = raw.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\b(please|thanks|thank you)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (YES.test(t)) return { type: 'yes' };
  if (NO.test(t)) return { type: 'no' };
  if (REPEAT.test(t)) return { type: 'repeat' };
  const m = t.match(/^(?:number |option |the )?(one|two|three|first|second|third|1|2|3)(?: one)?$/);
  if (m) return { type: 'choice', n: NUMBERS[m[1]] };
  return { type: null };
}

// UK postcode, e.g. "BS16 3EE" or "bs163ee": used to catch a mis-heard postcode before an address is saved.
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const postcodeOf = (text) => { const m = String(text || '').match(UK_POSTCODE); return m ? (m[1] + m[2]).toUpperCase() : null; };

// "PureGym, Bond Street": the name and the first part of the address that is not the name. The full address is too long to listen to.
export function shortName(r) {
  const seen = new Set();
  const parts = [...String(r.name || '').split(','), ...String(r.address || '').split(',')].map((x) => x.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, '').trim()).filter((x, i) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k) || (i > 0 && (/^\d/.test(x) || /^[A-Z]{1,2}\d/.test(x)))) return false;
    seen.add(k); return true;
  });
  return parts.slice(0, 2).join(', ');
}

// Is this a particular place (its name appears in the top result) or a kind of place ("grocery stores")?
const FILLER = new Set(['the', 'a', 'an', 'to', 'me', 'nearest', 'closest', 'nearby', 'near', 'any', 'some', 'find', 'a', 'in', 'at', 'of', 'for', 'and', 'on']);
export function isSpecific(query, top) {
  if (!top) return false;
  const words = String(query).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w));
  if (!words.length) return false;
  const hay = `${top.name} ${top.address || ''}`.toLowerCase().replace(/[^a-z0-9\s']/g, ' ');
  const stem = (w) => w.replace(/(ies|es|s)$/, '');
  return words.every((w) => hay.includes(w) || hay.includes(stem(w)) && stem(w).length > 3);
}

export class Dialogue {
  constructor({ say, nav, places = null, onPrompt = () => {}, timeoutMs = 40000, chooseTimeoutMs = 75000 }) {
    Object.assign(this, { say, nav, places, onPrompt, timeoutMs, chooseTimeoutMs });
    this.lastAsk = '';
    this.state = 'idle'; // idle | where | choose | confirm | savecheck
    this.misses = 0;
    this.timer = null;
  }

  // Say a question, and remember it so "repeat" can ask it again.
  _ask(text) { this.lastAsk = text; this.say(text, 'status'); }

  get waiting() { return this.state !== 'idle'; }

  _set(state, options = null) {
    this.state = state; this.misses = 0;
    clearTimeout(this.timer);
    if (state === 'idle') { this.pending = null; this.onPrompt(null); return; }
    this.onPrompt(options);
    this.timer = setTimeout(() => { this.say('I will cancel that. Say navigate to, and a place, to start again.', 'status'); this._set('idle'); }, state === 'choose' ? this.chooseTimeoutMs : this.timeoutMs);
  }

  // "Navigate" with no place: ask once, and take the next thing said as the place.
  askWhere() {
    this._set('where', [{ label: 'Cancel', value: 'no' }]);
    this._ask('Where to? Say the name of the place.');
  }

  async navigateTo(query) {
    this._set('idle');
    this.say(`Looking for ${query}.`, 'status');
    const found = await this.nav.find(query);
    if (!found) return;
    const { pos } = found;
    // Same place listed twice by the search: keep one.
    const seen = new Set();
    let results = found.results.filter((r) => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    // A named place ("University of Bristol", "Wills Memorial Building"): go straight there, like Google Maps.
    if (results.length === 1 || isSpecific(query, results[0])) return this._preview(pos, results[0]);
    // A kind of place ("grocery stores", "a pharmacy"): offer the nearest few.
    results = results.map((r) => ({ r, d: haversine(pos, r) })).sort((a, b) => a.d - b.d).slice(0, 3).map((x) => x.r);
    this.pending = { pos, results };
    const spoken = results.map((r, i) => `${['One', 'Two', 'Three'][i]}, ${shortName(r)}.`).join(' ');
    this._ask(`I found ${results.length} places. ${spoken} Say one, two or three.`);
    this._set('choose', results.map((r, i) => ({ label: `${i + 1}. ${r.name}`, value: String(i + 1) })));
    this.pending = { pos, results };
  }

  // "Save my home address as ...": look the address up, read back what was found, and save it only after a yes.
  // The walker cannot see a map, so the read-back (and a postcode check) is their only chance to catch a wrong match.
  async saveAddress(name, address) {
    this._set('idle');
    if (!this.places) return;
    this.say(`Looking for ${address}.`, 'status');
    let pos = null;
    try { pos = await Promise.race([this.nav.getPosition(), new Promise((r) => setTimeout(() => r(null), 3000))]); } catch { /* the bias is optional */ }
    let dest;
    try { dest = await this.nav.lookup(address, pos); } catch { this.say('I could not look that address up. Check your internet connection and try again.', 'status'); return; }
    if (!dest) { this.say(`I could not find ${address}. Try again with the street, the number and the postcode.`, 'status'); return; }
    const found = (dest.address || dest.name || '').replace(/,\s*(UK|United Kingdom)$/i, '');
    const asked = postcodeOf(address), got = postcodeOf(found);
    const warn = asked && got && asked !== got ? ' That is in a different postcode from the one you gave, so please check it.'
      : asked && !got ? ' I could not check the postcode.' : '';
    this._ask(`I found ${found}.${warn} Save it as ${name}? Say yes or no.`);
    this._set('savecheck', [{ label: 'Yes, save it', value: 'yes' }, { label: 'No', value: 'no' }]);
    this.pending = { name, dest, found };
  }

  // A place the walker saved earlier ("take me home"): no search, go straight to the distance and the yes/no.
  async navigateToSaved(place) {
    this._set('idle');
    let pos;
    try { pos = await this.nav.getPosition(); } catch (e) { this.say(locationMessage(e), 'status'); return; }
    return this._preview(pos, { lat: place.lat, lon: place.lon, large: false, name: `your ${place.name}` });
  }

  // Plan the route and start walking straight away. The start message gives the distance and time, and "cancel" stops it.
  async _preview(pos, dest) {
    const route = await this.nav.plan(pos, dest);
    if (!route) { if (!this.nav.active) this.say('I could not find a walking route there.', 'status'); return this._set('idle'); }
    if (!(route.distance >= 25)) { this.say(`You are already at ${dest.name}, or very close to it.`, 'status'); return this._set('idle'); }
    this.nav.begin(pos, dest, route, true, false);
  }

  // Returns true when the words were an answer to a question we asked (so they are not treated as commands).
  answer(text) {
    if (!this.waiting) return false;
    const a = parseAnswer(text);
    if (this.state === 'where') {
      if (a.type === 'no') { this.say('Okay, cancelled.', 'status'); this._set('idle'); return true; }
      const q = String(text).toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/^\s*(?:please\s+)?(?:(?:navigate|take|guide|bring|lead)\s+)?(?:me\s+)?(?:to\s+)?/, '').replace(/\s+/g, ' ').trim();
      if (q.length < 2) return this._miss();
      this._set('idle'); this.navigateTo(q); return true;
    }
    if (a.type === 'repeat' && this.lastAsk) { this.say(this.lastAsk, 'status'); return true; }
    if (this.state === 'savecheck') {
      if (a.type === 'yes') {
        const { name, dest, found } = this.pending; this._set('idle');
        const r = this.places.save(name, { lat: dest.lat, lon: dest.lon }, { address: found });
        this.say(`Saved as ${name}. To come back, say take me ${name === 'home' ? 'home' : `to ${name}`}.` +
          `${r && !r.persisted ? ' I could not store it on this phone, so I will only remember it until you close the page.' : ''}`, 'status');
        return true;
      }
      if (a.type === 'no') { this.say('Okay, I have not saved it. Say save my home address as, and the address, to try again.', 'status'); this._set('idle'); return true; }
      return this._miss();
    }
    if (a.type === 'no') { this.say('Okay, cancelled.', 'status'); this._set('idle'); return true; }
    if (this.state === 'confirm' && a.type === 'yes') {
      const { pos, dest, route } = this.pending; this._set('idle');
      this.nav.begin(pos, dest, route, true, true);
      return true;
    }
    if (this.state === 'choose' && a.type === 'choice') {
      const { pos, results } = this.pending;
      const dest = results[a.n - 1];
      if (dest) { this._set('idle'); this._preview(pos, dest, `Number ${a.n}. `); return true; }
    }
    if (this.state === 'choose' && a.type === 'yes') { this.say('Which one? Say one, two or three.', 'status'); return true; }
    if (!a.type) return this._miss();
    return this._miss();
  }

  _miss() {
    this.misses += 1;
    if (this.misses >= 2) { this.say('I did not catch that, so I have cancelled. Say navigate to, and a place, to try again.', 'status'); this._set('idle'); return true; }
    this.say(this.state === 'confirm' || this.state === 'savecheck' ? 'Please say yes or no.' : this.state === 'where' ? 'Say the name of the place.' : 'Please say one, two or three. Or say repeat.', 'status');
    return true;
  }

  cancel() { const was = this.waiting; this._set('idle'); return was; }
}
