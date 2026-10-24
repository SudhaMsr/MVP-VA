// Adds the cross-origin isolation headers GitHub Pages cannot send, so the browser allows
// multi-threaded WebAssembly. Opt-in with ?mt=1 (see index.html). Based on the well-known coi-serviceworker idea.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  const req = r.mode === 'no-cors' ? new Request(r, { credentials: 'omit' }) : r;
  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch(() => fetch(r)),
  );
});
