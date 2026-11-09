// App-shell service worker (Package B): Vision Assist installs to the home screen and starts with no signal.
// - Pages (index.html and the info pages): network first, so an update shows on the next open; the cached copy offline.
// - Scripts, the detection runtime, the manifest and icons: cache first (scripts carry their version in the address).
// - Models are NOT cached here: modelcache.js keeps them in their own cache ('va-models-v1'), which this never touches.
// - ?mt=1 (multi-threaded detection): this worker also adds the cross-origin isolation headers GitHub Pages cannot send,
//   for pages opened with ?mt=1 only. That used to be a separate worker (coi-sw.js); two workers cannot share one scope,
//   so with two the app could either be isolated or work offline, not both.
// The page never reloads because of this worker (a reload mid-walk would cut off the camera); updates take effect the next
// time the app is opened, and the app says "Vision Assist has updated." on that start.
// The block between the stamp markers is written by tools/stamp.py: do not edit it by hand.
/* stamp */
const VERSION = 'fe02beb';
const PRECACHE = [
  './',
  'index.html',
  'limits.html',
  'numbers.html',
  'privacy.html',
  'js/alerts.js?v=fe02beb',
  'js/app.js?v=fe02beb',
  'js/barge.js?v=fe02beb',
  'js/battery.js?v=fe02beb',
  'js/camcheck.js?v=fe02beb',
  'js/cloudstt.js?v=fe02beb',
  'js/cloudtts.js?v=fe02beb',
  'js/commands.js?v=fe02beb',
  'js/config.js?v=fe02beb',
  'js/cues.js?v=fe02beb',
  'js/depth.js?v=fe02beb',
  'js/describe.js?v=fe02beb',
  'js/detector.js?v=fe02beb',
  'js/dialogue.js?v=fe02beb',
  'js/floordist.js?v=fe02beb',
  'js/freespace.js?v=fe02beb',
  'js/haptics.js?v=fe02beb',
  'js/hazardalerts.js?v=fe02beb',
  'js/lanes.js?v=fe02beb',
  'js/modelcache.js?v=fe02beb',
  'js/nav.js?v=fe02beb',
  'js/notes.js?v=fe02beb',
  'js/output.js?v=fe02beb',
  'js/perf.js?v=fe02beb',
  'js/places.js?v=fe02beb',
  'js/platform.js?v=fe02beb',
  'js/privacy.js?v=fe02beb',
  'js/pwa.js?v=fe02beb',
  'js/reader.js?v=fe02beb',
  'js/routes.js?v=fe02beb',
  'js/safetext.js?v=fe02beb',
  'js/speech.js?v=fe02beb',
  'js/tracker.js?v=fe02beb',
  'js/trustcheck.js?v=fe02beb',
  'js/units.js?v=fe02beb',
  'vendor/ort/ort.min.js',
  'vendor/ort/ort-wasm-simd.wasm',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];
/* /stamp */
const CACHE = `va-shell-${VERSION}`;
const MT = /[?&]mt=1(?:&|$)/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // One missing file must not stop the rest being cached, so each is added on its own.
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' }))))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('va-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) {
  if (!res || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function isolated(event) {
  if (event.request.mode === 'navigate') return MT.test(event.request.url);
  try { const c = event.clientId && await self.clients.get(event.clientId); return !!c && MT.test(c.url); } catch (_) { return false; }
}

async function networkFirst(req, iso) {
  const cache = await caches.open(CACHE);
  const key = new URL(req.url); key.search = ''; // one copy per page, whatever the ?options
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key.href, res.clone()).catch(() => {});
    return iso ? isolate(res) : res;
  } catch (e) {
    const hit = await cache.match(key.href) || await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match(new URL('./', self.registration.scope).href));
    if (hit) return iso ? isolate(hit) : hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // Google speech, places and routes are POSTs: never touched
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && /\/models\//.test(url.pathname)) return; // modelcache.js handles models
  if (same && (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/'))) {
    event.respondWith(isolated(event).then((iso) => networkFirst(req, iso)));
    return;
  }
  if (same) { event.respondWith(cacheFirst(req)); return; }
  // Another site (maps, the OCR library, the runtime's CDN fallback): straight to the network, with the isolation
  // headers only for ?mt=1 pages.
  event.respondWith(isolated(event).then((iso) => {
    if (!iso) return fetch(req);
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return fetch(req);
    const r = req.mode === 'no-cors' ? new Request(req, { credentials: 'omit' }) : req;
    return fetch(r).then(isolate).catch(() => fetch(req));
  }));
});
