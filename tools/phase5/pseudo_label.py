# Step 5c (GPU session): add rod2 pseudo-labels to the PACKED training set (see pack_trainset.py). Same rules as the builder's
# optional step: old classes rod2 actually learned only; never on Phase 2 pictures, never on val/test (they stay hand-labelled);
# never for a class the source labels itself; not where a box already overlaps (IoU > 0.5); Red/Green light skipped where the
# source labels ped_signal. Pictures are the 416-px copies, predicted at 416 (the size the app runs this lane at).
# Globals: ROD2_PATH, PACK_ROOT (default /kaggle/working/p5), PSEUDO_CONF (default 0.5). Writes pseudo_report.json into PACK_ROOT.
import os, json, glob, collections, subprocess, sys
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLO
R = globals().get('PACK_ROOT', '/kaggle/working/p5'); CONF = globals().get('PSEUDO_CONF', 0.5)
meta = json.load(open(f'{R}/pack_meta.json')); CLASSES = meta['classes']; own = {k: set(v) for k, v in meta['own_classes'].items()}
learned = {i for i in range(30) if CLASSES[i] not in set(meta['unlearned'])}
RED, GREEN, PED = CLASSES.index('Red light'), CLASSES.index('Green light'), CLASSES.index('ped_signal')
m = YOLO(globals().get('ROD2_PATH') or next(p for p in glob.glob('/kaggle/input/**/rod2_best.pt', recursive=True)))
def iou(a, b):
    ax0, ay0, ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx0, by0, bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    i = max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0))
    return i / (a[2] * a[3] + b[2] * b[3] - i + 1e-12)
todo = [f for f in sorted(os.listdir(f'{R}/images/train')) if not f.startswith('phase2__')]
pseudo = collections.Counter()
for k in range(0, len(todo), 128):
    batch = todo[k:k + 128]
    for f, r in zip(batch, m.predict([f'{R}/images/train/{f}' for f in batch], imgsz=416, conf=CONF, verbose=False)):
        stem = os.path.splitext(f)[0]; src = stem.split('__')[0]; lp = f'{R}/labels/train/{stem}.txt'
        lines = [l for l in open(lp).read().splitlines() if l.strip()]
        have = [list(map(float, l.split()[1:5])) for l in lines]; add = []
        for c, b in zip(r.boxes.cls.tolist(), r.boxes.xywhn.tolist()):
            c = int(c)
            if c not in learned or c in own.get(src, set()) or any(iou(b, h) > 0.5 for h in have): continue
            if c in (RED, GREEN) and PED in own.get(src, set()): continue
            add.append(f'{c} ' + ' '.join(f'{v:.6f}' for v in b)); have.append(b); pseudo[CLASSES[c]] += 1
        if add: open(lp, 'w').write('\n'.join(lines + add) + '\n')
    if k % 12800 == 0: print(f'pseudo-labelled {min(k + 128, len(todo))}/{len(todo)}', flush=True)
json.dump(dict(pseudo), open(f'{R}/pseudo_report.json', 'w'), indent=1); print('pseudo boxes', dict(pseudo))
