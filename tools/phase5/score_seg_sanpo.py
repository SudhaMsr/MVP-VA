# Score the surface-segmentation PILOT (ncseg_best.pt, Vistas-trained, non-commercial) on the SANPO walker test frames it never saw.
# Run in a Kaggle notebook with two datasets attached: "SANPO walker view test subset" (folder sanpo_test: images/, masks/,
# labelmap.json, labeltype.json) and the private pilot dataset ncseg-surface-pilot-v1. CPU is enough (584 small frames). One line:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/phase5/score_seg_sanpo.py").read())
# Metric: pixel IoU per class over all frames (strict), plus a relaxed version that forgives a 3 px offset (kerbs are thin), and
# precision / recall in pixels. Ground truth = SANPO human masks (red channel = class id). TEST ONLY; pilot weights never ship.
import os, glob, json, subprocess, sys
import numpy as np
from PIL import Image
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLO
from scipy import ndimage

OUT = globals().get('OUT_DIR', '/kaggle/working/seg_sanpo'); os.makedirs(OUT, exist_ok=True)
CONF = globals().get('CONF', 0.25); IMGSZ = globals().get('IMGSZ', 640); TOL = globals().get('TOL', 3)
root = next(p for p in glob.glob('/kaggle/input/**/sanpo_test', recursive=True) if os.path.isdir(p))
wpath = next(p for p in glob.glob('/kaggle/input/**/ncseg_best.pt', recursive=True))
labelmap = json.load(open(f'{root}/labelmap.json')); id2name = {int(v): k for k, v in labelmap.items()}
print('SANPO classes:', sorted(id2name.values()), flush=True)
model = YOLO(wpath); names = model.names; print('pilot classes:', names, flush=True)


def ids_for(pred):
    return [i for i, n in id2name.items() if pred(n.lower())]


GT = {  # pilot class -> SANPO class ids (kerb cut has no SANPO equivalent)
    'road': ids_for(lambda n: n == 'road' or (n.startswith('road') and not any(w in n for w in ('barrier', 'marking', 'sign')))),
    'sidewalk': ids_for(lambda n: n.startswith('sidewalk') or n == 'pavement'),
    'curb': ids_for(lambda n: n.startswith('curb')),
}
print('GT ids used:', {k: [id2name[i] for i in v] for k, v in GT.items()}, flush=True)
acc = {k: dict(tp=0, fp=0, fn=0, rtp=0, rfp=0, rfn=0, frames_gt=0, frames_hit=0) for k in GT}
se = ndimage.generate_binary_structure(2, 1)
imgs = sorted(glob.glob(f'{root}/images/*.jpg')); n = 0
for ip in imgs:
    stem = os.path.splitext(os.path.basename(ip))[0]; mp = f'{root}/masks/{stem}.png'
    if not os.path.exists(mp): continue
    im = Image.open(ip).convert('RGB'); W, H = im.size
    cls = np.array(Image.open(mp).convert('RGB').resize((W, H), Image.NEAREST))[..., 0]
    r = model.predict(np.array(im)[..., ::-1], imgsz=IMGSZ, conf=CONF, retina_masks=True, verbose=False)[0]
    pred = {k: np.zeros((H, W), bool) for k in GT}
    if r.masks is not None:
        for m, c in zip(r.masks.data.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)):
            k = names[c]
            if k in pred:
                mm = m if m.shape == (H, W) else np.array(Image.fromarray((m * 255).astype('uint8')).resize((W, H))) > 127
                pred[k] |= mm.astype(bool)
    for k, ids in GT.items():
        g = np.isin(cls, ids); p = pred[k]; a = acc[k]
        a['tp'] += int((g & p).sum()); a['fp'] += int((~g & p).sum()); a['fn'] += int((g & ~p).sum())
        gd = ndimage.binary_dilation(g, se, TOL) if g.any() else g; pd = ndimage.binary_dilation(p, se, TOL) if p.any() else p
        a['rtp'] += int((g & pd).sum()); a['rfn'] += int((g & ~pd).sum()); a['rfp'] += int((p & ~gd).sum())
        if g.sum() >= 0.001 * H * W:
            a['frames_gt'] += 1; a['frames_hit'] += int((g & pd).sum() >= 0.2 * g.sum())
    n += 1
rep = {'frames': n, 'conf': CONF, 'imgsz': IMGSZ, 'tolerance_px': TOL, 'classes': {}}
for k, a in acc.items():
    d = lambda x, y: round(x / y, 3) if y else None
    rep['classes'][k] = {'IoU_strict': d(a['tp'], a['tp'] + a['fp'] + a['fn']), 'precision': d(a['tp'], a['tp'] + a['fp']), 'recall': d(a['tp'], a['tp'] + a['fn']),
        'IoU_relaxed': d(a['rtp'], a['rtp'] + a['rfp'] + a['rfn']), 'precision_relaxed': d(a['rtp'], a['rtp'] + a['rfp']), 'recall_relaxed': d(a['rtp'], a['rtp'] + a['rfn']),
        'frames_with_GT': a['frames_gt'], 'frames_found_relaxed': a['frames_hit'], 'GT_ids': [id2name[i] for i in GT[k]]}
json.dump(rep, open(f'{OUT}/seg_sanpo_report.json', 'w'), indent=1)
print(json.dumps(rep, indent=1))
