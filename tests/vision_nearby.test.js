// 12 Nov: Google reading and "describe this" (Cloud Vision), and "what is near me" (Google Places).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setUnits, setStep } from '../docs/js/units.js';
import { buildVisionRequest, parseRead, sceneSpeech, sideOfBox, CloudVision } from '../docs/js/cloudvision.js';
import { searchNearby, nearbySpeech, sideOf, WalkHeading } from '../docs/js/nearby.js';
import { readingSpeech } from '../docs/js/reader.js';
import { parseCommand, HELP_TEXT } from '../docs/js/commands.js';
import { isSafeText } from '../docs/js/safetext.js';
setUnits('steps'); setStep(0.7);

const sym = (ch, brk) => ({ text: ch, property: brk ? { detectedBreak: { type: brk } } : undefined });
const word = (w, last) => ({ symbols: [...w].map((c, i) => sym(c, i === w.length - 1 ? (last ? 'LINE_BREAK' : 'SPACE') : null)) });
const block = (text, x1, y1, x2, y2, confidence = 0.95) => ({
  confidence, boundingBox: { vertices: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] },
  paragraphs: [{ words: text.split(' ').map((w, i, a) => word(w, i === a.length - 1)) }],
});
const box = (x1, x2) => ({ normalizedVertices: [{ x: x1, y: 0.2 }, { x: x2, y: 0.2 }, { x: x2, y: 0.9 }, { x: x1, y: 0.9 }] });

test('vision request: reading asks for text only; describing asks for things, labels, logos and text', () => {
  const r = buildVisionRequest('AAA', 'read');
  assert.deepEqual(r.requests[0].features.map((f) => f.type), ['TEXT_DETECTION']);
  assert.equal(r.requests[0].image.content, 'AAA');
  assert.deepEqual(buildVisionRequest('AAA', 'look').requests[0].features.map((f) => f.type), ['OBJECT_LOCALIZATION', 'LABEL_DETECTION', 'LOGO_DETECTION', 'TEXT_DETECTION']);
});

test('reading: the biggest writing first (the shop sign before the small print), in the usual wording', () => {
  const resp = { fullTextAnnotation: { pages: [{ blocks: [block('Open 7am to 6pm', 100, 400, 220, 420), block('COSTA COFFEE', 50, 50, 600, 160)] }] } };
  const parsed = parseRead(resp);
  assert.equal(parsed.engine, 'google');
  assert.deepEqual(parsed.pieces, ['COSTA COFFEE', 'Open 7am to 6pm']);
  assert.equal(readingSpeech(parsed), 'It says: COSTA COFFEE. Open 7am to 6pm.');
  assert.match(readingSpeech(parseRead({})), /^I can't read any text/);
});

test('describe this: things with their side, the kind of place, the logo and the sign, all hedged', () => {
  const resp = {
    localizedObjectAnnotations: [
      { name: 'Person', score: 0.9, boundingPoly: box(0.05, 0.2) }, { name: 'Person', score: 0.8, boundingPoly: box(0.1, 0.3) },
      { name: 'Bicycle', score: 0.85, boundingPoly: box(0.7, 0.95) }, { name: 'Door', score: 0.7, boundingPoly: box(0.4, 0.6) },
      { name: 'Car', score: 0.3, boundingPoly: box(0.4, 0.6) },
    ],
    labelAnnotations: [{ description: 'Sky', score: 0.98 }, { description: 'Coffeehouse', score: 0.9 }, { description: 'Building', score: 0.88 }, { description: 'Person', score: 0.95 }, { description: 'Vague', score: 0.5 }],
    logoAnnotations: [{ description: 'Costa Coffee', score: 0.8 }],
    fullTextAnnotation: { pages: [{ blocks: [block('COSTA', 50, 50, 600, 160)] }] },
  };
  const t = sceneSpeech(resp);
  assert.equal(t, 'I think I can see 2 people on the left, a bicycle on the right and a door ahead. It looks like coffeehouse and building. The logo looks like Costa Coffee. Writing says: COSTA.');
  assert.ok(!/car/i.test(t), 'a low-score guess is left out');
  assert.ok(isSafeText(t));
});

test('describe this: nothing recognised is said honestly', () => {
  const t = sceneSpeech({});
  assert.match(t, /^I could not make out what is in front of you/);
  assert.ok(isSafeText(t));
});

test('side of a box: left, ahead and right thirds of the picture', () => {
  assert.equal(sideOfBox(box(0, 0.2)), 'on the left');
  assert.equal(sideOfBox(box(0.4, 0.6)), 'ahead');
  assert.equal(sideOfBox(box(0.8, 1)), 'on the right');
  assert.equal(sideOfBox(null), null);
});

test('vision: a refused key switches to the phone for the rest of the walk; a picture is only sent when asked', async () => {
  const sent = [];
  const v = new CloudVision({ key: 'k', fetchFn: async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: false, status: 403, text: async () => 'API_KEY_SERVICE_BLOCKED' }; } });
  assert.equal(v.usable, true);
  await assert.rejects(v.annotate('AAA', 'read'));
  assert.equal(v.usable, false);
  assert.equal(sent.length, 1);
  const ok = new CloudVision({ key: 'k', fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ responses: [{ textAnnotations: [{ description: 'BUS STOP' }] }] }) }) });
  assert.deepEqual(parseRead(await ok.annotate('AAA', 'read')).pieces, ['BUS STOP']);
});

// ---- near me ----
const HERE = { lat: 51.4545, lon: -2.5879 };
const north = (m) => ({ lat: HERE.lat + m / 111320, lon: HERE.lon });
const east = (m) => ({ lat: HERE.lat, lon: HERE.lon + m / (111320 * Math.cos(HERE.lat * Math.PI / 180)) });

test('near me: nearest first, with the kind of place, distance in steps, and which side when walking', () => {
  const places = [
    { name: 'Post Office', type: 'Post office', ...north(60) },
    { name: 'Costa Coffee', type: 'Coffee shop', ...east(14) },
    { name: 'Far Away Shop', type: 'Store', ...north(400) },
  ];
  const t = nearbySpeech(places, HERE, { heading: 0 }); // walking north
  assert.equal(t, 'Near you: Costa Coffee, coffee shop, 20 steps on your right. Post Office, 90 steps ahead. Map positions can be a few steps out.');
  assert.ok(isSafeText(t));
});

test('near me without a walking direction: distances only, and how to get the side', () => {
  const t = nearbySpeech([{ name: 'Boots', type: 'Pharmacy', ...north(30) }], HERE, { heading: null });
  assert.equal(t, 'Near you: Boots, pharmacy, 40 steps. Walk a few steps and ask again to hear which side they are on.');
});

test('asking for a kind of place: nearest ones, and how to go there; nothing found is said plainly', () => {
  const t = nearbySpeech([{ name: 'Greggs', type: 'Bakery', ...north(300) }], HERE, { heading: 180, query: 'bakery' });
  assert.equal(t, 'Nearest: Greggs, bakery, 450 steps behind you. Map positions can be a few steps out. Say navigate to Greggs, to go there.');
  assert.equal(nearbySpeech([], HERE, { query: 'post office' }), 'I could not find a post office near you.');
  assert.equal(nearbySpeech([], HERE, {}), 'I could not find any shops or places close to you.');
});

test('side of a place: ahead, right, behind, left from the walking direction; none without one', () => {
  assert.equal(sideOf(HERE, north(50), 0), 'ahead');
  assert.equal(sideOf(HERE, east(50), 0), 'on your right');
  assert.equal(sideOf(HERE, north(-50), 0), 'behind you');
  assert.equal(sideOf(HERE, east(-50), 0), 'on your left');
  assert.equal(sideOf(HERE, east(50), 90), 'ahead');
  assert.equal(sideOf(HERE, east(50), null), null);
});

test('walking direction from location fixes: needs about 8 m of movement, ignores rough fixes, trusts the GPS heading when moving', () => {
  const h = new WalkHeading();
  h.add({ ...HERE, accuracy: 10, t: 0 });
  h.add({ ...north(4), accuracy: 10, t: 3000 });
  assert.equal(h.get(3000), null, 'only 4 m: standing still or GPS drift');
  h.add({ ...north(12), accuracy: 10, t: 8000 });
  assert.ok(Math.abs(h.get(8000)) < 2, `walking north: ${h.get(8000)}`);
  assert.equal(h.get(30000), null, 'old fixes say nothing about now');
  const rough = new WalkHeading();
  rough.add({ ...HERE, accuracy: 80, t: 0 }); rough.add({ ...east(20), accuracy: 80, t: 5000 });
  assert.equal(rough.get(5000), null);
  const gps = new WalkHeading();
  gps.add({ ...HERE, accuracy: 8, heading: 270, speed: 1.3, t: 0 });
  assert.equal(gps.get(500), 270);
});

test('places search: nearby or by kind, nearest first, permanently closed places left out', async () => {
  const calls = [];
  const fetchFn = async (url, o) => { calls.push({ url, body: JSON.parse(o.body), mask: o.headers['X-Goog-FieldMask'] });
    return { ok: true, json: async () => ({ places: [
      { displayName: { text: 'Costa Coffee' }, primaryTypeDisplayName: { text: 'Coffee shop' }, location: { latitude: 51.4546, longitude: -2.5878 } },
      { displayName: { text: 'Old Bank' }, businessStatus: 'CLOSED_PERMANENTLY', location: { latitude: 51.4546, longitude: -2.5878 } },
    ] }) }; };
  const all = await searchNearby(HERE, { key: 'k', fetchFn });
  assert.deepEqual(all.map((p) => p.name), ['Costa Coffee']);
  assert.match(calls[0].url, /places:searchNearby$/);
  assert.equal(calls[0].body.rankPreference, 'DISTANCE');
  assert.match(calls[0].mask, /primaryTypeDisplayName/);
  await searchNearby(HERE, { key: 'k', fetchFn, query: 'cafe' });
  assert.match(calls[1].url, /places:searchText$/);
  assert.equal(calls[1].body.textQuery, 'cafe');
  await assert.rejects(searchNearby(HERE, { key: 'k', fetchFn: async () => ({ ok: false, status: 403 }) }));
});

test('commands: near me, a kind of place nearby, the nearest one, and describe this', () => {
  for (const p of ['what is near me', 'what is around me', "what's nearby", 'what shops are near me', 'anything near me']) assert.deepEqual(parseCommand(p), { type: 'nearby' }, p);
  assert.deepEqual(parseCommand('is there a cafe near me'), { type: 'nearby', arg: 'cafe' });
  assert.deepEqual(parseCommand('find a post office nearby'), { type: 'nearby', arg: 'post office' });
  assert.deepEqual(parseCommand('where is the nearest bank'), { type: 'nearby', arg: 'bank' });
  for (const p of ['describe this', 'what am i looking at', 'what is this', "what's that"]) assert.equal(parseCommand(p).type, 'look', p);
  // unchanged
  assert.equal(parseCommand('is there a bench').type, 'find');
  assert.equal(parseCommand('what is in front of me').type, 'describe');
  assert.equal(parseCommand('describe the scene').type, 'describe');
  assert.equal(parseCommand('what is this place').type, 'read');
  assert.equal(parseCommand('where is my key').type, 'noteFind');
  assert.equal(parseCommand('navigate to the nearest cafe').type, 'navigate');
  assert.match(HELP_TEXT, /what is near me/);
});

test('app.js: describe this falls back to the phone, reading tries Google first', () => {
  const src = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /case 'look': lookNow\(\)/);
  assert.match(src, /case 'nearby': nearbyNow\(/);
  assert.match(src, /vision\.annotate\(.*'read'\)/);
  assert.match(src, /so this is what I can see on the phone/);
});

// ---- Google only (12 Nov: the owner has Google credits) ----
test('Google only: navigation never calls OpenStreetMap; a failed Google call is tried once more', async () => {
  const { makeProviders } = await import('../docs/js/nav.js');
  const urls = []; let fails = 1;
  const fetchFn = async (url) => {
    urls.push(url);
    if (fails > 0) { fails -= 1; return { ok: false, status: 503, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ places: [{ displayName: { text: 'Cabot Circus' }, formattedAddress: 'Bristol', location: { latitude: 51.459, longitude: -2.585 } }] }) };
  };
  const heard = [];
  const p = makeProviders({ googleKey: 'k', fetchFn, googleOnly: true, retryMs: 1, notify: (t) => heard.push(t) });
  const g = await p.geocode('cabot circus', HERE);
  assert.equal(g.source, 'google');
  assert.equal(urls.length, 2, 'one retry');
  assert.ok(urls.every((u) => /googleapis\.com/.test(u)), urls.join(' '));
  assert.deepEqual(heard, [], 'no "using backup maps"');
  const down = makeProviders({ googleKey: 'k', googleOnly: true, retryMs: 1, fetchFn: async (u) => { urls.push(u); return { ok: false, status: 403, json: async () => ({}) }; } });
  await assert.rejects(down.route(HERE, north(100)));
  assert.ok(!urls.some((u) => /openstreetmap/.test(u)));
});

test('where am I from Google Places: the street most nearby places are on, the nearest named place, no house number', async () => {
  const { reverseLookup, describePlace } = await import('../docs/js/places.js');
  const urls = [];
  const comp = (road, num) => [...(num ? [{ longText: num, types: ['street_number'] }] : []), { longText: road, types: ['route'] }, { longText: 'Bristol', types: ['postal_town'] }];
  const fetchFn = async (url) => { urls.push(url); return { ok: true, json: async () => ({ places: [
    { displayName: { text: 'Charming 1 Bed Flat' }, primaryType: 'lodging', addressComponents: comp('Colston Avenue') },
    { displayName: { text: 'Colston Statue Plinth' }, primaryType: 'historical_landmark', addressComponents: comp('Colston Avenue') },
    { displayName: { text: 'Accountancy Recruit' }, primaryType: 'consultant', addressComponents: comp('Baldwin Street', '29') },
  ] }) }; };
  const j = await reverseLookup(HERE, fetchFn, 'k');
  assert.equal(describePlace(j), 'You are on Colston Avenue, in Bristol. Close by is Colston Statue Plinth.');
  assert.equal(urls.length, 1); assert.match(urls[0], /places\.googleapis\.com/);
  assert.equal(describePlace(await reverseLookup(HERE, async () => ({ ok: true, json: async () => ({}) }), 'k')), 'I could not tell which street you are on.');
  await assert.rejects(reverseLookup(HERE, async () => ({ ok: false, status: 500 }), 'k'));
});

test('app.js: navigation and where am I are Google only', () => {
  const src = readFileSync(new URL('../docs/js/app.js', import.meta.url), 'utf8');
  assert.match(src, /googleOnly: true/);
  assert.equal((src.match(/reverseLookup\(pos, undefined, GOOGLE_KEY\)/g) || []).length, 2);
});
