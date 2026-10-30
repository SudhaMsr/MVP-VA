// "I can't see clearly." A covered, dark or pocketed camera makes the detector silent, and a blind walker hears
// silence as "all clear". This watches a tiny copy of each frame (32 x 24 grey pixels, checked about once a second):
// too dark, or almost no detail at all (a finger or a pocket over the lens), for a few seconds in a row -> say so.
// Then remind at most every `repeatMs` while it lasts, and say once when the picture is back.

export function frameStats(grey) {
  // grey: array of 0..255 values. Mean brightness and contrast (standard deviation).
  const n = grey.length; if (!n) return { mean: 0, sd: 0 };
  let sum = 0; for (let i = 0; i < n; i++) sum += grey[i];
  const mean = sum / n;
  let v = 0; for (let i = 0; i < n; i++) v += (grey[i] - mean) ** 2;
  return { mean, sd: Math.sqrt(v / n) };
}

export function looksBlocked({ mean, sd }, cfg = {}) {
  const dark = cfg.darkMean ?? 28, flat = cfg.flatSd ?? 7;
  if (mean < dark) return 'dark';
  if (sd < flat) return 'covered';
  return null;
}

export class CameraWatch {
  constructor({ say, log = () => {}, holdMs = 3000, repeatMs = 30000, cfg = {} } = {}) {
    Object.assign(this, { say, log, holdMs, repeatMs, cfg });
    this.reset();
  }

  reset() { this.badSince = null; this.saidAt = null; this.blocked = false; }

  // stats = frameStats(...), t = ms clock. Returns the reason while blocked, else null.
  update(stats, t) {
    const why = looksBlocked(stats, this.cfg);
    if (!why) {
      if (this.blocked) { this.say('I can see again.', 'status'); this.log('camera-clear', ''); }
      this.badSince = null; this.blocked = false; this.saidAt = null;
      return null;
    }
    if (this.badSince == null) this.badSince = t;
    if (t - this.badSince < this.holdMs) return null; // a brief hand wave or a dark doorway is not worth a message
    if (!this.blocked || t - this.saidAt >= this.repeatMs) {
      this.say(why === 'dark'
        ? "I can't see clearly. It is too dark for the camera."
        : "I can't see clearly. Check that nothing is covering the camera.", 'status');
      this.log('camera-blocked', why);
      this.blocked = true; this.saidAt = t;
    }
    return why;
  }
}

// Browser helper: grey pixels from a video element via a small canvas (reused).
let cnv = null;
export function greyFromVideo(video, w = 32, h = 24) {
  if (!video || !video.videoWidth) return null;
  if (!cnv) { cnv = document.createElement('canvas'); cnv.width = w; cnv.height = h; }
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) out[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return out;
}
