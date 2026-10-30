#!/usr/bin/env python3
"""Phase 2, step 2: merge the labelled datasets into ONE YOLO training set that extends our existing slow-lane model.
Standard library only. It only READS your raw folder and writes a NEW output folder; nothing in data/raw is changed.

    python3 tools/phase2/prepare.py --raw "/home/sudha/Developer/Vision Assist/data/raw" --out ~/phase2_data
    (add --dry-run first to see the counts without copying any pictures)

Classes: the 25 classes of weights/rod_best.pt keep their numbers (0-24), then the new ones are appended (25...).
Output: <out>/images/{train,val}, <out>/labels/{train,val}, data.yaml, data_old25.yaml (+ labels25/ for the baseline check),
manifest.csv (source + licence note per picture), report.txt. Zip <out> and upload it to Google Drive for Colab."""
import argparse, csv, json, os, random, shutil, sys
from collections import Counter, defaultdict

ROD = ['Bike', 'Building', 'Car', 'Person', 'Stairs', 'Traffic sign', 'Electrical Pole', 'Road', 'Motorcycle', 'Dustbin', 'Dog', 'Manhole',
       'Tree', 'Guard rail', 'Pedestrian crosswalk', 'Truck', 'Bus', 'Bench', 'Traffic Cone', 'Fire hydrant', 'Teraffic Barrel', 'Plant Pot',
       'Electrical Box', 'Chair', 'Bicycle Rack']
NEW = ['Bollard', 'Downstairs', 'Upstairs', 'Red light', 'Green light']  # appended after the 25
NAMES = ROD + NEW
ID = {n: i for i, n in enumerate(NAMES)}
IMG = ('.jpg', '.jpeg', '.png')
CAP = {'blind_assist': 100000, 'stairs': 1200, 'traffic_light': 1500, 'road_traffic': 100000, 'coco': 1500}

# dataset class name -> our class (None = drop that box)
BLIND = {'Bollard': 'Bollard', 'bin': 'Dustbin', 'downstairs': 'Downstairs', 'upstairs': 'Upstairs'}
TRAFFIC = {'green': 'Green light', 'red': 'Red light', 'yellow': None, 'off': None}
ROADT = {'bicycles': 'Bike', 'buses': 'Bus', 'crosswalks': 'Pedestrian crosswalk', 'fire hydrants': 'Fire hydrant', 'motorcycles': 'Motorcycle',
         'stairs': 'Stairs', 'taxis': 'Car', 'vehicles': 'Car', 'bridges': None, 'chimneys': None, 'tractors': None, 'traffic lights': None}
COCO = {'person': 'Person', 'bicycle': 'Bike', 'car': 'Car', 'motorcycle': 'Motorcycle', 'bus': 'Bus', 'truck': 'Truck', 'bench': 'Bench',
        'chair': 'Chair', 'fire hydrant': 'Fire hydrant', 'dog': 'Dog', 'potted plant': 'Plant Pot'}

def yaml_names(path):
    """Class names from a data.yaml: PyYAML if installed, else bracket list, '0: name' lines, or '- name' lines."""
    import re
    try:
        import yaml
        n = (yaml.safe_load(open(path, encoding='utf-8', errors='ignore')) or {}).get('names')
        if isinstance(n, dict): return [str(n[k]) for k in sorted(n, key=lambda x: int(x))]
        if isinstance(n, list): return [str(x) for x in n]
    except Exception:
        pass
    txt = open(path, encoding='utf-8', errors='ignore').read()
    m = re.search(r'names:\s*\[(.*?)\]', txt, re.S)
    if m: return [x.strip(" '\"\n") for x in m.group(1).split(',') if x.strip()]
    m = re.search(r'names:\s*\n((?:\s*\d+\s*:.*\n?)+)', txt)
    if m: return [l.split(':', 1)[1].strip(" '\"\r") for l in m.group(1).splitlines() if ':' in l]
    m = re.search(r'names:\s*\n((?:\s*-\s*.*\n?)+)', txt)
    if m: return [l.split('-', 1)[1].strip(" '\"\r") for l in m.group(1).splitlines() if '-' in l]
    return []

def find_pairs(root):
    """(image path, label path or None, split hint) for a Roboflow-style folder tree."""
    out = []
    for dp, _, fs in os.walk(root):
        parts = dp.replace('\\', '/').split('/')
        if 'images' not in parts: continue
        for f in fs:
            if f.lower().endswith(IMG):
                lbl = os.path.join(dp.replace(os.sep + 'images', os.sep + 'labels'), os.path.splitext(f)[0] + '.txt')
                split = 'val' if any(p in ('valid', 'val') for p in parts) else ('test' if 'test' in parts else 'train')
                out.append((os.path.join(dp, f), lbl if os.path.exists(lbl) else None, split))
    return out

def remap_yolo(lbl, src_names, mapping):
    rows = []
    if not lbl: return rows
    for line in open(lbl):
        p = line.split()
        if len(p) < 5 or not p[0].isdigit() or int(p[0]) >= len(src_names): continue
        tgt = mapping.get(src_names[int(p[0])])
        if tgt: rows.append((ID[tgt], *[float(x) for x in p[1:5]]))
    return rows

def stairs_lines_to_box(lbl, size=512.0):
    """One box around every stair-edge line endpoint (that is how the dataset's own review converted them)."""
    xs, ys = [], []
    for line in open(lbl):
        p = line.split()
        if len(p) != 5: continue
        x1, y1, x2, y2 = (float(v) for v in p[1:])
        xs += [x1, x2]; ys += [y1, y2]
    if not xs: return []
    x1, x2, y1, y2 = max(0, min(xs)), min(size, max(xs)), max(0, min(ys)), min(size, max(ys))
    if x2 - x1 < 8 or y2 - y1 < 8: return []
    return [(ID['Stairs'], (x1 + x2) / 2 / size, (y1 + y2) / 2 / size, (x2 - x1) / size, (y2 - y1) / size)]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--raw', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args(); rnd = random.Random(a.seed)
    items = []  # (source, licence, img, rows, split)
    def add(src, lic, img, rows, split):
        if rows: items.append((src, lic, img, rows, split))

    d = os.path.join(a.raw, 'blind_assist_walk_street')
    if os.path.isdir(d):
        names = yaml_names(os.path.join(d, 'data.yaml'))
        for img, lbl, sp in find_pairs(d): add('blind_assist', 'CC BY 4.0 (Roboflow ch-chandu)', img, remap_yolo(lbl, names, BLIND), sp)
    d = os.path.join(a.raw, 'traffic-light-detection')
    if os.path.isdir(d):
        names = yaml_names(os.path.join(d, 'data.yaml')); tl = []
        for img, lbl, sp in find_pairs(d):
            rows = remap_yolo(lbl, names, TRAFFIC)
            if rows: tl.append(('traffic_light', 'see traffic-light-detection/README.dataset.txt', img, rows, sp))
        rnd.shuffle(tl); items += tl[:CAP['traffic_light']]
    d = os.path.join(a.raw, 'road-traffic')
    if os.path.isdir(d):
        names = yaml_names(os.path.join(d, 'data.yaml'))
        if not names: print('WARNING: road-traffic/data.yaml class names not read')
        for img, lbl, sp in find_pairs(d): add('road_traffic', 'see road-traffic/', img, remap_yolo(lbl, names, ROADT), sp)
    d = os.path.join(a.raw, 'stairs_specialist', 'extracted')
    if os.path.isdir(d):
        st = []
        for dp, _, fs in os.walk(d):
            parts = dp.replace('\\', '/').split('/')
            if 'labels' not in parts: continue
            for f in fs:
                if not f.endswith('.txt'): continue
                img = None
                for ext in ('.jpg', '.jpeg', '.png'):
                    cand = os.path.join(dp.replace(os.sep + 'labels', os.sep + 'images'), f[:-4] + ext)
                    if os.path.exists(cand): img = cand; break
                if img and not img.endswith('.png'):  # the .png files are depth maps; we want the colour photos
                    st.append(('stairs', 'CC BY 4.0 (Mendeley, Wang et al., Beihang University)', img, stairs_lines_to_box(os.path.join(dp, f)), 'val' if 'val' in parts else 'train'))
        st = [x for x in st if x[3]]; rnd.shuffle(st); items += st[:CAP['stairs']]
    d = os.path.join(a.raw, 'coco')
    ann = [os.path.join(dp, f) for dp, _, fs in os.walk(d) for f in fs if f in ('instances_train2017.json', 'instances_val2017.json')] if os.path.isdir(d) else []
    if ann:
        index = {f: os.path.join(dp, f) for dp, _, fs in os.walk(d) for f in fs if f.lower().endswith(IMG)}
        ann.sort(key=lambda p: 'val' in p)  # prefer train2017 when present
        j = json.load(open(ann[0])); cats = {c['id']: c['name'] for c in j['categories']}; imgs = {i['id']: i for i in j['images']}; per = defaultdict(list)
        for an in j['annotations']:
            t = COCO.get(cats[an['category_id']])
            im = imgs[an['image_id']]
            if t and not an.get('iscrowd') and im['file_name'] in index:
                x, y, w, h = an['bbox']; W, H = im['width'], im['height']
                if w > 4 and h > 4: per[im['id']].append((ID[t], (x + w / 2) / W, (y + h / 2) / H, w / W, h / H))
        co = [('coco', 'COCO: CC BY 4.0 annotations, Flickr image licences', index[imgs[i]['file_name']], r, 'train') for i, r in per.items()]
        rnd.shuffle(co); items += co[:CAP['coco']]
    # split: a source's own val split is kept; sources with none get 10% val
    for src in set(i[0] for i in items):
        mine = [k for k, i in enumerate(items) if i[0] == src]
        if not any(items[k][4] == 'val' for k in mine):
            for k in rnd.sample(mine, max(1, len(mine) // 10)): items[k] = items[k][:4] + ('val',)
    items = [i[:4] + ('val' if i[4] == 'val' else 'train',) for i in items]  # a 'test' split joins train; uk_own provides the honest test later
    rep = Counter(); box = Counter(); size = 0
    for src, _, img, rows, sp in items:
        rep[(src, sp)] += 1
        for r in rows: box[NAMES[r[0]]] += 1
        size += os.path.getsize(img)
    lines = ['pictures by source/split: ' + ', '.join(f'{s}/{p}={n}' for (s, p), n in sorted(rep.items())), f'total pictures {len(items)}, about {size/1e9:.2f} GB',
             'boxes per class: ' + ', '.join(f'{k}={v}' for k, v in sorted(box.items(), key=lambda kv: -kv[1]))]
    never = [n for n in NAMES if n not in box]
    lines.append('classes with NO boxes in this set (the model will not learn them from here): ' + ', '.join(never))
    print('\n'.join(lines))
    if a.dry_run: return
    os.makedirs(a.out, exist_ok=True)
    man = csv.writer(open(os.path.join(a.out, 'manifest.csv'), 'w', newline=''))
    man.writerow(['file', 'source', 'split', 'licence_note', 'original_path'])
    for k, (src, lic, img, rows, sp) in enumerate(items):
        stem = f'{src}_{k:06d}'
        for sub in ('images', 'labels', 'labels25'):
            os.makedirs(os.path.join(a.out, sub, sp), exist_ok=True)
        shutil.copyfile(img, os.path.join(a.out, 'images', sp, stem + os.path.splitext(img)[1].lower()))
        fmt = lambda r: f'{r[0]} {r[1]:.6f} {r[2]:.6f} {r[3]:.6f} {r[4]:.6f}\n'
        open(os.path.join(a.out, 'labels', sp, stem + '.txt'), 'w').writelines(fmt(r) for r in rows)
        old = [r for r in rows if r[0] < len(ROD)]
        open(os.path.join(a.out, 'labels25', sp, stem + '.txt'), 'w').writelines(fmt(r) for r in old)
        man.writerow([stem, src, sp, lic, img])
    nm = lambda names: '\n'.join(f'  {i}: {n}' for i, n in enumerate(names))
    open(os.path.join(a.out, 'data.yaml'), 'w').write(f'path: .\ntrain: images/train\nval: images/val\nnames:\n{nm(NAMES)}\n')
    open(os.path.join(a.out, 'report.txt'), 'w').write('\n'.join(lines) + '\n')
    print('written to', a.out)

if __name__ == '__main__': main()
