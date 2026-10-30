// Keep the detection models on the phone after the first download, so later starts do not fetch about 24 MB again
// and the app still starts on a weak signal. Uses the browser's Cache Storage.
// A model file can be replaced on the site under the same name (a retrained model), so after a start from the cache
// the file is checked again in the background (ETag / size) and the cache is refreshed for the next start.
// If Cache Storage is missing or fails, the caller falls back to loading straight from the network.

export const CACHE_NAME = 'va-models-v1';

const tag = (res) => (res && (res.headers.get('etag') || res.headers.get('content-length'))) || '';

export async function modelBytes(url, { caches: cs = globalThis.caches, fetchFn = (...a) => fetch(...a), log = () => {} } = {}) {
  let cache = null;
  try { cache = cs ? await cs.open(CACHE_NAME) : null; } catch (_) { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer());
        refresh(url, cache, tag(hit), fetchFn, log); // not awaited: never delays the start
        log('model-cache', `hit ${url}`);
        return buf;
      }
    } catch (_) { /* fall through to the network */ }
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`model ${url}: HTTP ${res.status}`);
  if (cache) { try { await cache.put(url, res.clone()); log('model-cache', `stored ${url}`); } catch (_) { /* storage full or blocked: fine */ } }
  return new Uint8Array(await res.arrayBuffer());
}

async function refresh(url, cache, oldTag, fetchFn, log) {
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (!res.ok) return;
    if (tag(res) && tag(res) === oldTag) return; // unchanged; the body is simply dropped
    await cache.put(url, res);
    log('model-cache', `updated ${url}`);
  } catch (_) { /* offline: keep what we have */ }
}

// Fill the cache while the page sits open, before Start is tapped. Does nothing if it is already there.
export async function warmModel(url, opts = {}) {
  const cs = opts.caches ?? globalThis.caches;
  try {
    const cache = cs ? await cs.open(CACHE_NAME) : null;
    if (!cache || await cache.match(url)) return false;
    const res = await (opts.fetchFn ?? fetch)(url);
    if (res.ok) { await cache.put(url, res); return true; }
  } catch (_) { /* best effort */ }
  return false;
}
