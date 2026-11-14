# Diagnose weak Phase 5 classes: box sizes at the 416 px training size, giant boxes, and contact sheets of real examples.
# Run in a Kaggle notebook with the source datasets attached. Prints a table and writes /kaggle/working/diag/*.jpg.
import os, glob, random, collections, json
from concurrent.futures import ThreadPoolExecutor
import kagglehub, yaml
from PIL import Image, ImageDraw
random.seed(1)
OUT = '/kaggle/working/diag'; os.makedirs(OUT, exist_ok=True)
SZ = 416
SETS = globals().get('DIAG_SETS', {
    'vistas': ('sudharanimsr/vistas-va-yolo640', ['kerb', 'dropped_kerb', 'street_light', 'ped_signal']),
    'kerbs': ('sudharanimsr/kerbs-yolo640', ['kerb', 'dropped_kerb']),
    'barcelona': ('sudharanimsr/barcelona-streets-kerbs-drops-yolo640', None),
    'phase2': ('sudharanimsr/phase2-rod2-training-data', ['Truck', 'Red light', 'Green light', 'Electrical Pole']),
    'openimages': ('sudharanimsr/open-images-va-classes', ['pole', 'ped_signal']),
})
N_FILES = globals().get('DIAG_FILES', 4000)


def names_for(root):
    y = sorted(glob.glob(root + '/**/data.yaml', recursive=True))
    n = yaml.safe_load(open(y[0]))['names'] if y else []
    return [n[k] for k in sorted(n)] if isinstance(n, dict) else list(n)


def pairs(root):
    out = []
    for lp in glob.glob(root + '/**/labels/**/*.txt', recursive=True):
        ip = None
        for e in ('.jpg', '.png', '.jpeg'):
            c = '/images/'.join(lp.rsplit('/labels/', 1))[:-4] + e
            if os.path.exists(c): ip = c; break
        if ip: out.append((lp, ip))
    return out


def one(p):
    lp, ip = p
    try:
        W, H = Image.open(ip).size; s = SZ / max(W, H)
        rows = [l.split() for l in open(lp) if l.strip()]
        return ip, [(int(float(r[0])), float(r[3]) * W * s, float(r[4]) * H * s, list(map(float, r[1:5]))) for r in rows if len(r) == 5]
    except Exception:
        return ip, []


table = {}
for tag, (slug, want) in SETS.items():
    root = kagglehub.dataset_download(slug); names = names_for(root)
    ps = pairs(root); random.shuffle(ps); ps = ps[:N_FILES]
    with ThreadPoolExecutor(32) as ex: res = list(ex.map(one, ps))
    stats = collections.defaultdict(list); ex_imgs = collections.defaultdict(list)
    for ip, boxes in res:
        for c, w, h, b in boxes:
            n = names[c] if c < len(names) else f'id{c}'
            if want and n not in want: continue
            stats[n].append((w, h)); ex_imgs[n].append((ip, b))
    for n, wh in stats.items():
        ws = sorted(min(w, h) for w, h in wh); areas = [w * h / (SZ * SZ) for w, h in wh]
        table[f'{tag}:{n}'] = {'boxes': len(wh), 'median_short_side_px': round(ws[len(ws) // 2], 1),
                               'under_6px': round(sum(x < 6 for x in ws) / len(ws), 3),
                               'under_10px': round(sum(x < 10 for x in ws) / len(ws), 3),
                               'over_25pct_of_image': round(sum(a > .25 for a in areas) / len(areas), 3)}
        # contact sheet: 12 random images, only this class drawn
        by = collections.defaultdict(list)
        for ip, b in ex_imgs[n]: by[ip].append(b)
        pick = random.sample(list(by), min(12, len(by))); tiles = []
        for ip in pick:
            im = Image.open(ip).convert('RGB'); im.thumbnail((480, 480)); d = ImageDraw.Draw(im); W, H = im.size
            for x, y, w, h in by[ip]: d.rectangle([(x - w / 2) * W, (y - h / 2) * H, (x + w / 2) * W, (y + h / 2) * H], outline=(255, 40, 40), width=3)
            tiles.append(im.resize((480, 360)))
        sheet = Image.new('RGB', (480 * 4, 360 * 3))
        for i, t in enumerate(tiles): sheet.paste(t, ((i % 4) * 480, (i // 4) * 360))
        sheet.save(f"{OUT}/{tag}_{n.replace(' ', '_')}.jpg", quality=80)
    print(tag, 'done', flush=True)
for k, v in table.items(): print(f'{k:40s} {v}')
json.dump(table, open(f'{OUT}/table.json', 'w'), indent=1)
