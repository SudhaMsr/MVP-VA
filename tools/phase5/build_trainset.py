# Step 5 of the final MVP training plan: build the Phase 5 training set (39 classes, tools/phase5/label_map.json) from the
# private Kaggle datasets, without copying images: images are symlinked from /kaggle/input, labels are rewritten.
# Run in a Kaggle notebook with every source dataset attached (GPU only if PSEUDO is on). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/phase5/build_trainset.py").read())
# What it does, in order:
#  1. For each source, finds every images/ folder with a matching labels/ folder and the nearest data.yaml (class names).
#     Phase 2 is identity (rod2's 30 classes keep their ids). Other sources: each class name is looked up in the source's
#     map in label_map.json; names not in the map are DROPPED, never guessed. Sources whose map is still "_todo" are skipped.
#  2. Split: a source's own val/valid split becomes val and its test split becomes test; otherwise 5% val and 5% test by a
#     hash of the GROUP key (the file name up to the last '_' or '-', so frames of one sequence stay together). Val and
#     test are never trained on; test is the held-out check for the new classes.
#  3. Caps: MAX_PER_SOURCE images per source (train split only), keeping images with the rarest classes first.
#  4. De-duplication: 256-bit average hash of each picture; an exact repeat of a picture already kept is dropped.
#  5. Optional pseudo-labels (PSEUDO=True, GPU): rod2 adds boxes for the old classes it actually learned, at score
#     >= PSEUDO_CONF, on new-source pictures only, never for a class that source labels itself, and not where a box already
#     overlaps (IoU > 0.5). Pseudo lines are counted separately in the report.
# Output: /kaggle/working/p5/{images,labels}/{train,val,test}, data.yaml, report.json (boxes per class, split and source).
import os, re, glob, json, hashlib, random, subprocess, sys, urllib.request, collections
from concurrent.futures import ThreadPoolExecutor
try:
    import yaml
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'pyyaml'], check=True); import yaml
import kagglehub
from PIL import Image

COMMIT = globals().get('MAP_COMMIT', 'main')
OUT = globals().get('OUT_DIR', '/kaggle/working/p5')
THREADS = globals().get('THREADS', 48)
PSEUDO = globals().get('PSEUDO', False)
PSEUDO_CONF = globals().get('PSEUDO_CONF', 0.5)
ROD2 = globals().get('ROD2_PATH', None)
LM = json.loads(urllib.request.urlopen(f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/label_map.json').read())
CLASSES = LM['classes']
# Kaggle slug -> key in label_map.json "sources"
SOURCES = globals().get('SOURCES', {
    'sudharanimsr/phase2-rod2-training-data': 'phase2-rod2-training-data',
    'sudharanimsr/vistas-va-yolo640': 'vistas-va-yolo640',
    'sudharanimsr/kerbs-yolo640': 'kerbs-yolo640',
    'sudharanimsr/potholes-yolo640': 'potholes-yolo640',
    'sudharanimsr/e-scooters-bollards-yolo640': 'e-scooters-bollards-yolo640',
    'sudharanimsr/barcelona-streets-kerbs-drops-yolo640': 'barcelona-streets-kerbs-drops-yolo640',
    'sudharanimsr/open-images-va-classes': 'open-images-va-classes',
    'sudharanimsr/vip-mobility360-640px': 'vip-mobility360-640px',
})
MAX_PER_SOURCE = globals().get('MAX_PER_SOURCE', {'vip-mobility360-640px': 15000, 'potholes-yolo640': 4000,
                                                   'barcelona-streets-kerbs-drops-yolo640': 8000})
IMG = ('.jpg', '.jpeg', '.png', '.webp')
# rod2 classes with no boxes in the Phase 2 data (audit 13 Nov): rod2 never learned them, so it must not pseudo-label them
UNLEARNED = {'Building', 'Traffic sign', 'Electrical Pole', 'Road', 'Manhole', 'Tree', 'Guard rail', 'Traffic Cone',
             'Teraffic Barrel', 'Electrical Box', 'Bicycle Rack'}


def yaml_names(p):
    try:
        n = (yaml.safe_load(open(p)) or {}).get('names')
    except Exception:
        return None
    if isinstance(n, dict): return [str(n[k]) for k in sorted(n, key=lambda x: int(x))]
    return [str(x) for x in n] if isinstance(n, list) else None


def nearest_names(d, root):
    while True:
        for f in ('data.yaml', 'dataset.yaml'):
            if os.path.exists(os.path.join(d, f)) and yaml_names(os.path.join(d, f)): return yaml_names(os.path.join(d, f))
        if os.path.samefile(d, root) or os.path.dirname(d) == d: return None
        d = os.path.dirname(d)


def split_of(parts, stem, identity=False):
    if any(p in ('val', 'valid', 'validation') for p in parts): return 'val'
    if identity: return 'train'  # Phase 2: rod2 already trained on its train split, so none of it is an honest val/test
    if 'test' in parts: return 'test'
    group = re.split(r'[_-][^_-]*$', stem)[0] or stem
    h = int(hashlib.md5(group.encode()).hexdigest(), 16) % 20
    return 'val' if h == 0 else 'test' if h == 1 else 'train'


def ahash(p):
    try:
        im = Image.open(p).convert('L').resize((16, 16)); px = list(im.getdata()); m = sum(px) / 256
        h = sum(1 << i for i, v in enumerate(px) if v > m)
        return None if h in (0, (1 << 256) - 1) else h  # a flat picture has no usable hash: never call it a duplicate
    except Exception:
        return None


items = []  # dict(src, img, lines, split)
report = {'skipped_sources': {}, 'dropped_names': collections.defaultdict(collections.Counter)}
for slug, key in SOURCES.items():
    smap = LM['sources'].get(key, {})
    if '_todo' in smap: report['skipped_sources'][key] = smap['_todo']; print('skip', key, '(map not filled)', flush=True); continue
    identity = smap.get('identity', False)
    root = kagglehub.dataset_download(slug); n0 = len(items)
    for d, dirs, files in os.walk(root):
        parts = d.replace('\\', '/').split('/')
        if 'images' not in parts: continue
        imgs = [f for f in files if f.lower().endswith(IMG)]
        if not imgs: continue
        ldir = '/labels'.join(d.rsplit('/images', 1)); names = nearest_names(d, root)
        if not os.path.isdir(ldir) or not names: continue
        if identity: assert names[:30] == CLASSES[:30], (key, names[:30])
        lut = {i: (i if identity else (CLASSES.index(smap[n.lower()]) if n.lower() in smap else None)) for i, n in enumerate(names)}
        for f in imgs:
            stem = os.path.splitext(f)[0]; lp = os.path.join(ldir, stem + '.txt'); out = []
            if os.path.exists(lp):
                for l in open(lp):
                    p = l.split()
                    if len(p) != 5: continue
                    c = lut.get(int(float(p[0])))
                    if c is None: report['dropped_names'][key][names[int(float(p[0]))] if int(float(p[0])) < len(names) else p[0]] += 1; continue
                    out.append(f'{c} ' + ' '.join(p[1:]))
            if out or identity:  # Phase 2 keeps its background pictures; other sources only pictures with a mapped box
                items.append({'src': key, 'img': os.path.join(d, f), 'lines': out, 'split': split_of(parts, stem, identity)})
    print(f'{key}: {len(items) - n0} pictures with mapped boxes', flush=True)

# caps (train only), rarest classes first
freq = collections.Counter(int(l.split()[0]) for it in items for l in it['lines'])
random.seed(0)
by_src = collections.defaultdict(list)
for it in items: by_src[it['src']].append(it)
kept = []
for src, lst in by_src.items():
    cap = MAX_PER_SOURCE.get(src)
    tr = [i for i in lst if i['split'] == 'train']; rest = [i for i in lst if i['split'] != 'train']
    if cap and len(tr) > cap:
        random.shuffle(tr); tr.sort(key=lambda i: min((freq[int(l.split()[0])] for l in i['lines']), default=10 ** 9)); tr = tr[:cap]
    kept += tr + rest

# de-duplicate by picture hash
with ThreadPoolExecutor(THREADS) as ex: hashes = list(ex.map(lambda i: ahash(i['img']), kept))
seen, final, dups = set(), [], collections.Counter()
for it, h in zip(kept, hashes):
    if h is not None and h in seen: dups[it['src']] += 1; continue
    if h is not None: seen.add(h)
    final.append(it)
report['duplicates_dropped'] = dict(dups)

# optional pseudo-labels for the old classes rod2 learned
pseudo = collections.Counter()
if PSEUDO:
    try:
        import ultralytics  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
    from ultralytics import YOLO
    m = YOLO(ROD2 or next(p for p in glob.glob('/kaggle/input/**/rod2_best.pt', recursive=True)))
    learned = {i for i in range(30) if CLASSES[i] not in UNLEARNED}
    own = {key: {CLASSES.index(v) for k, v in LM['sources'][key].items() if not k.startswith('_') and isinstance(v, str)} for key in SOURCES.values() if key in LM['sources']}
    todo = [it for it in final if it['src'] != 'phase2-rod2-training-data']
    def iou(a, b):
        ax0, ay0, ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
        bx0, by0, bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
        i = max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0))
        return i / (a[2] * a[3] + b[2] * b[3] - i + 1e-12)
    for k in range(0, len(todo), 64):
        batch = todo[k:k + 64]
        for it, r in zip(batch, m.predict([i['img'] for i in batch], imgsz=640, conf=PSEUDO_CONF, verbose=False)):
            have = [list(map(float, l.split()[1:])) for l in it['lines']]
            for c, b in zip(r.boxes.cls.tolist(), r.boxes.xywhn.tolist()):
                c = int(c)
                if c not in learned or c in own.get(it['src'], set()) or any(iou(b, h) > 0.5 for h in have): continue
                it['lines'].append(f'{c} ' + ' '.join(f'{v:.6f}' for v in b)); have.append(b); pseudo[CLASSES[c]] += 1
        if k % 6400 == 0: print(f'pseudo-labelled {min(k + 64, len(todo))}/{len(todo)}', flush=True)
report['pseudo_boxes'] = dict(pseudo)

# write
counts = collections.defaultdict(collections.Counter); pics = collections.Counter()
for sp in ('train', 'val', 'test'):
    os.makedirs(f'{OUT}/images/{sp}', exist_ok=True); os.makedirs(f'{OUT}/labels/{sp}', exist_ok=True)
for it in final:
    stem = re.sub(r'[^A-Za-z0-9_.-]', '_', it['src'].split('-')[0] + '__' + os.path.splitext(os.path.basename(it['img']))[0])
    ext = os.path.splitext(it['img'])[1].lower(); dst = f"{OUT}/images/{it['split']}/{stem}{ext}"
    if not os.path.lexists(dst): os.symlink(it['img'], dst)
    open(f"{OUT}/labels/{it['split']}/{stem}.txt", 'w').write('\n'.join(it['lines']) + ('\n' if it['lines'] else ''))
    pics[(it['src'], it['split'])] += 1
    for l in it['lines']: counts[it['split']][CLASSES[int(l.split()[0])]] += 1
open(f'{OUT}/data.yaml', 'w').write(f'path: {OUT}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n' + ''.join(f'  {i}: {c}\n' for i, c in enumerate(CLASSES)))
report['pictures'] = {f'{s}/{p}': n for (s, p), n in sorted(pics.items())}
report['boxes'] = {sp: dict(sorted(c.items(), key=lambda x: -x[1])) for sp, c in counts.items()}
report['classes_without_train_boxes'] = [c for c in CLASSES if counts['train'][c] == 0]
report['dropped_names'] = {k: dict(v.most_common(15)) for k, v in report['dropped_names'].items()}
json.dump(report, open(f'{OUT}/report.json', 'w'), indent=1)
print(json.dumps(report, indent=1))
