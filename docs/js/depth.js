// Test-only depth lane (?depth=1). Depth Anything V2 Small (quantized, about 26 MB) estimates how near every part of
// the picture is. It is relative depth (nearer / further), not metres. For now it only measures its own speed on the
// phone and shows a depth picture in the camera view, so we can judge whether it is worth using for drops and steps.
// It never speaks.
import { modelBytes } from './modelcache.js';

export const DEPTH = { url: 'models/depth_s_q.onnx', size: 252, everyMs: 2000 }; // size: a multiple of 14

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

// Scale a depth map to 0..1 (1 = nearest). Pure, for tests.
export function normalise(d) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Float32Array(d.length), span = hi - lo || 1;
  for (let i = 0; i < d.length; i++) out[i] = (d[i] - lo) / span;
  return out;
}

export class DepthLane {
  constructor(ort, cfg = DEPTH) { this.ort = ort; this.cfg = cfg; this.session = null; this.times = []; this.last = null; this.ranAt = 0; }

  async load(log = () => {}) {
    let src = this.cfg.url;
    try { src = await modelBytes(this.cfg.url, { log }); } catch (_) { src = this.cfg.url; }
    this.session = await this.ort.InferenceSession.create(src, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const S = this.cfg.size;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = S;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.buf = new Float32Array(3 * S * S);
  }

  due(t) { return this.session && t - this.ranAt >= this.cfg.everyMs; }

  async run(video, t) {
    this.ranAt = t;
    const S = this.cfg.size, n = S * S, t0 = performance.now();
    this.ctx.drawImage(video, 0, 0, S, S);
    const px = this.ctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < n; i++) {
      this.buf[i] = (px[4 * i] / 255 - MEAN[0]) / STD[0];
      this.buf[n + i] = (px[4 * i + 1] / 255 - MEAN[1]) / STD[1];
      this.buf[2 * n + i] = (px[4 * i + 2] / 255 - MEAN[2]) / STD[2];
    }
    const input = new this.ort.Tensor('float32', this.buf, [1, 3, S, S]);
    const out = await this.session.run({ [this.session.inputNames[0]]: input });
    const d = out[this.session.outputNames[0]];
    this.last = { map: normalise(d.data), w: d.dims[2], h: d.dims[1] };
    const ms = performance.now() - t0;
    this.times.push(ms); if (this.times.length > 15) this.times.shift();
    return ms;
  }

  medianMs() { const a = this.times.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; }

  // A small near-is-bright picture in the top right corner of the debug view.
  draw(g, w) {
    if (!this.last) return;
    const { map, w: mw, h: mh } = this.last;
    if (!this.thumb) { this.thumb = document.createElement('canvas'); this.thumb.width = mw; this.thumb.height = mh; }
    const tc = this.thumb.getContext('2d'), img = tc.createImageData(mw, mh);
    for (let i = 0; i < map.length; i++) { const v = Math.round(map[i] * 255); img.data[4 * i] = v; img.data[4 * i + 1] = Math.round(v * 0.6); img.data[4 * i + 2] = 255 - v; img.data[4 * i + 3] = 255; }
    tc.putImageData(img, 0, 0);
    const tw = Math.round(w * 0.3);
    g.drawImage(this.thumb, w - tw - 8, 8, tw, tw);
  }
}
