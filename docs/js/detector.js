// Pure helpers (testable in Node) + a Detector class that wraps onnxruntime-web.
import { CLASSES } from './config.js';

export function letterbox(srcW, srcH, size) {
  const r = Math.min(size / srcW, size / srcH);
  const w = Math.round(srcW * r);
  const h = Math.round(srcH * r);
  return { r, w, h, dx: Math.floor((size - w) / 2), dy: Math.floor((size - h) / 2) };
}

// RGBA bytes (size*size*4) -> planar RGB floats 0..1 (3*size*size).
export function rgbaToTensor(rgba, size, out) {
  const n = size * size;
  const dst = out || new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    dst[i] = rgba[i * 4] / 255;
    dst[n + i] = rgba[i * 4 + 1] / 255;
    dst[2 * n + i] = rgba[i * 4 + 2] / 255;
  }
  return dst;
}

export function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

// YOLOv8 output is channels-first: [1, 4+nc, N]. Boxes are cx,cy,w,h in letterboxed input pixels.
export function decode(output, N, lb, srcW, srcH, conf, nmsIou, numClasses = CLASSES.length) {
  const cands = [];
  for (let i = 0; i < N; i++) {
    let best = -1, bs = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = output[(4 + c) * N + i];
      if (s > bs) { bs = s; best = c; }
    }
    if (best < 0 || bs < conf) continue;
    const cx = output[i], cy = output[N + i], w = output[2 * N + i], h = output[3 * N + i];
    const x1 = Math.min(srcW, Math.max(0, (cx - w / 2 - lb.dx) / lb.r));
    const y1 = Math.min(srcH, Math.max(0, (cy - h / 2 - lb.dy) / lb.r));
    const x2 = Math.min(srcW, Math.max(0, (cx + w / 2 - lb.dx) / lb.r));
    const y2 = Math.min(srcH, Math.max(0, (cy + h / 2 - lb.dy) / lb.r));
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    cands.push({ cls: best, name: CLASSES[best], score: bs, x1, y1, x2, y2 });
  }
  cands.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of cands) {
    let drop = false;
    for (const k of kept) {
      if (k.cls === c.cls && iou(k, c) > nmsIou) { drop = true; break; }
    }
    if (!drop) kept.push(c);
    if (kept.length >= 40) break;
  }
  return kept;
}

export class Detector {
  constructor(ort, size) {
    this.ort = ort;
    this.size = size;
    this.session = null;
    this.canvas = null;
    this.ctx = null;
    this.buf = new Float32Array(3 * size * size);
  }

  async load(url, providers = ['wasm']) {
    const ort = this.ort;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated)
      ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    this.session = await ort.InferenceSession.create(url, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    });
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.providers = providers;
  }

  async detect(video, conf, nmsIou) {
    const size = this.size;
    const sw = video.videoWidth, sh = video.videoHeight;
    if (!sw || !sh) throw new Error('video not ready');
    const lb = letterbox(sw, sh, size);
    this.ctx.fillStyle = 'rgb(114,114,114)';
    this.ctx.fillRect(0, 0, size, size);
    this.ctx.drawImage(video, 0, 0, sw, sh, lb.dx, lb.dy, lb.w, lb.h);
    const rgba = this.ctx.getImageData(0, 0, size, size).data;
    rgbaToTensor(rgba, size, this.buf);
    const input = new this.ort.Tensor('float32', this.buf, [1, 3, size, size]);
    const out = await this.session.run({ [this.inputName]: input });
    const t = out[this.outputName];
    const N = t.dims[2];
    return { dets: decode(t.data, N, lb, sw, sh, conf, nmsIou), width: sw, height: sh };
  }
}
