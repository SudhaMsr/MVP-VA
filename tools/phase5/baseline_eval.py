# Step 4 of the final MVP training plan: score a detector (rod2 now, its successor later) on the walker's-eye test sets
# it was never trained on, in the Phase 5 class numbering. Classes 0-29 of rod2 are Phase 5 classes 0-29, so its class
# ids are used unchanged; a 39-class successor is scored the same way.
# Run in a Kaggle notebook with the model dataset and the test-set datasets attached (GPU optional). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/phase5/baseline_eval.py").read())
# Per class: AP50 (all-point interpolation, greedy matching at IoU 0.5, highest score first), and precision and recall at
# the app's own threshold (rod2 lane: 416 px input, score 0.40, from docs/js/config.js). SANPO's groups (any vehicle, any
# traffic light) are scored as one class each: predictions of every member class are pooled. A test set's class counts
# as scored only if it has at least MIN_GT boxes; the others are listed but not averaged.
# Caveat written into the report: SANPO kerb, guard rail, tree and pole boxes come from semantic masks split into
# connected patches, so one real object can be several boxes or one box can cover several; their AP is a rough guide.
import os, glob, json, subprocess, sys, urllib.request
import numpy as np
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLO

COMMIT = globals().get('MAP_COMMIT', 'main')
MODEL = globals().get('MODEL_PATH') or next(p for p in sorted(glob.glob('/kaggle/input/**/*.pt', recursive=True)) if 'rod2' in p.lower() or 'best' in p.lower())
IMGSZ = globals().get('IMGSZ', 416)
APP_CONF = globals().get('APP_CONF', 0.40)
MIN_GT = globals().get('MIN_GT', 30)
OUT = globals().get('OUT_DIR', '/kaggle/working/baseline')
TAG = globals().get('TAG', 'rod2')
LM = json.loads(urllib.request.urlopen(f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/label_map.json').read())
CLASSES, GROUPS = LM['classes'], LM['test_only']['sanpo-walker-view-test-subset']['_groups']


def find(name):
    return next((p for p in glob.glob(f'/kaggle/input/**/{name}', recursive=True) if os.path.isdir(p)), None)


TESTSETS = {k: v for k, v in {'sanpo': find('sanpo_yolo'), 'bristol': find('bristol_reviewed')}.items() if v}


def iou(a, b):
    x0, y0 = np.maximum(a[0], b[:, 0]), np.maximum(a[1], b[:, 1]); x1, y1 = np.minimum(a[2], b[:, 2]), np.minimum(a[3], b[:, 3])
    inter = np.clip(x1 - x0, 0, None) * np.clip(y1 - y0, 0, None)
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]) - inter + 1e-12)


def xyxy(x, y, w, h): return [x - w / 2, y - h / 2, x + w / 2, y + h / 2]


def score(preds, gts):
    """preds: list of (img, conf, box); gts: dict img -> array of boxes. Returns AP50, P and R at APP_CONF, counts."""
    n_gt = sum(len(v) for v in gts.values())
    if n_gt == 0: return None
    preds = sorted(preds, key=lambda p: -p[1]); used = {k: np.zeros(len(v), bool) for k, v in gts.items()}
    tp = np.zeros(len(preds)); conf = np.array([p[1] for p in preds])
    for i, (img, c, box) in enumerate(preds):
        g = gts.get(img)
        if g is None or not len(g): continue
        o = iou(np.array(box), g); o[used[img]] = 0; j = int(o.argmax())
        if o[j] >= 0.5: tp[i] = 1; used[img][j] = True
    ctp = np.cumsum(tp); rec = ctp / n_gt; prec = ctp / np.arange(1, len(preds) + 1) if len(preds) else np.array([])
    mrec = np.concatenate([[0], rec, [1]]); mpre = np.concatenate([[1], prec, [0]])
    mpre = np.flip(np.maximum.accumulate(np.flip(mpre))); ap = float(np.sum((mrec[1:] - mrec[:-1]) * mpre[1:]))
    k = conf >= APP_CONF; n_k = int(k.sum()); tp_k = float(tp[k].sum())
    return {'gt': n_gt, 'ap50': round(ap, 4), 'precision_at_app_conf': round(tp_k / n_k, 4) if n_k else None,
            'recall_at_app_conf': round(tp_k / n_gt, 4), 'predictions_at_app_conf': n_k}


model = YOLO(MODEL); names = model.names
print('model', MODEL, '| classes', len(names), '| first names match Phase 5:', all(names[i] == CLASSES[i] for i in range(min(len(names), 30))), flush=True)
os.makedirs(OUT, exist_ok=True)
report = {'model': MODEL, 'tag': TAG, 'imgsz': IMGSZ, 'app_conf': APP_CONF, 'min_gt': MIN_GT, 'testsets': {}}
for ts, root in TESTSETS.items():
    imgs = sorted(glob.glob(f'{root}/images/*.jpg'))
    gt, gtg, pred = {}, {}, {}
    for p in imgs:
        stem = os.path.splitext(os.path.basename(p))[0]
        for line in open(f'{root}/labels/{stem}.txt').read().split('\n'):
            if line.strip():
                c, x, y, w, h = line.split()[:5]; gt.setdefault(int(c), {}).setdefault(stem, []).append(xyxy(*map(float, (x, y, w, h))))
        gp = f'{root}/labels/{stem}.groups.json'
        if os.path.exists(gp):
            for g in json.load(open(gp)): gtg.setdefault(g['group'], {}).setdefault(stem, []).append(xyxy(*g['box']))
    for k in range(0, len(imgs), 32):
        for r in model.predict(imgs[k:k + 32], imgsz=IMGSZ, conf=0.001, iou=0.6, max_det=300, verbose=False):
            stem = os.path.splitext(os.path.basename(r.path))[0]
            for c, b, s in zip(r.boxes.cls.tolist(), r.boxes.xyxyn.tolist(), r.boxes.conf.tolist()):
                pred.setdefault(int(c), []).append((stem, s, b))
    res = {}
    for c, g in sorted(gt.items()):
        s = score(pred.get(c, []), {k: np.array(v) for k, v in g.items()})
        if s: s['scored'] = s['gt'] >= MIN_GT; res[CLASSES[c]] = s
    for grp, g in gtg.items():
        members = [CLASSES.index(m) for m in GROUPS.get(grp, []) if CLASSES.index(m) < len(names)]
        s = score([p for m in members for p in pred.get(m, [])], {k: np.array(v) for k, v in g.items()})
        if s: s['scored'] = s['gt'] >= MIN_GT; s['members'] = [CLASSES[m] for m in members]; res[f'group: {grp}'] = s
    sc = [v['ap50'] for v in res.values() if v['scored']]
    report['testsets'][ts] = {'images': len(imgs), 'per_class': res, 'mean_ap50_scored': round(float(np.mean(sc)), 4) if sc else None}
    print(f'\n{ts}: {len(imgs)} images, mean AP50 over {len(sc)} scored classes = {report["testsets"][ts]["mean_ap50_scored"]}', flush=True)
    for n, v in res.items():
        print(f"  {n:24s} gt {v['gt']:5d}  AP50 {v['ap50']:.3f}  P@{APP_CONF} {v['precision_at_app_conf']}  R@{APP_CONF} {v['recall_at_app_conf']}" + ('' if v['scored'] else '  (too few boxes, not averaged)'))
report['caveat'] = ('SANPO kerb, guard rail, tree and pole boxes come from semantic masks split into connected patches, so their AP '
                    'is a rough guide. Bristol labels are YOLO-World pre-labels corrected by review on a stated sample.')
json.dump(report, open(f'{OUT}/baseline_{TAG}.json', 'w'), indent=1)
print('\nsaved', f'{OUT}/baseline_{TAG}.json')
