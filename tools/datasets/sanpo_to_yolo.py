# Turn the SANPO walker's-eye test subset (frames + raw panoptic masks) into YOLO boxes in the Phase 5 class numbering.
# Run in a Kaggle notebook with the dataset "SANPO walker view test subset" attached (CPU is enough). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/sanpo_to_yolo.py").read())
# Mask encoding (checked on the data 13 Nov): RGB PNG, red = class id from labelmap.json, blue = instance id (0 for classes
# that are "semantic" in labeltype.json). Panoptic classes: one box per (class, instance). Semantic classes we use (curb,
# guard rail): one box per connected patch of at least MIN_PIXELS pixels. The class map comes from tools/phase5/label_map.json.
# Classes SANPO cannot tell apart (any vehicle, any traffic light) are written to groups.json and scored as groups.
# TEST ONLY: never train on these labels.
import os, io, json, glob, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

COMMIT = globals().get('MAP_COMMIT', 'main')
OUT = globals().get('OUT_DIR', '/kaggle/working/sanpo_yolo')
MIN_PIXELS = globals().get('MIN_PIXELS', 400)      # on the full 2208 x 1242 mask
MIN_SIDE = 6                                      # pixels, both box sides
LM = json.loads(urllib.request.urlopen(f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/label_map.json').read())
CLASSES = LM['classes']
SMAP = {k: v for k, v in LM['test_only']['sanpo-walker-view-test-subset'].items() if not k.startswith('_')}
GROUPS = LM['test_only']['sanpo-walker-view-test-subset'].get('_groups', {})

root = next(p for p in glob.glob('/kaggle/input/**/sanpo_test', recursive=True) if os.path.isdir(p))
labelmap = json.load(open(f'{root}/labelmap.json')); labeltype = json.load(open(f'{root}/labeltype.json'))
id2name = {int(v): k for k, v in labelmap.items()}
want = {i: n for i, n in id2name.items() if n in SMAP or n in GROUPS}
print('SANPO classes used:', {n: SMAP.get(n, 'group') for n in want.values()}, flush=True)

os.makedirs(f'{OUT}/images', exist_ok=True); os.makedirs(f'{OUT}/labels', exist_ok=True)
counts, group_boxes, n_img = {}, {}, 0
for img_path in sorted(glob.glob(f'{root}/images/*.jpg')):
    stem = os.path.splitext(os.path.basename(img_path))[0]
    mpath = f'{root}/masks/{stem}.png'
    if not os.path.exists(mpath): continue
    m = np.array(Image.open(mpath).convert('RGB'))
    H, W = m.shape[:2]; cls, inst = m[..., 0], m[..., 2]
    lines, groups = [], []
    for cid, name in want.items():
        sel = cls == cid
        if not sel.any(): continue
        if labeltype.get(name) == 'panoptic':
            parts = [(sel & (inst == k)) for k in np.unique(inst[sel])]
        else:
            lab, n = ndimage.label(sel); parts = [lab == k for k in range(1, n + 1)]
        for part in parts:
            if part.sum() < MIN_PIXELS: continue
            ys, xs = np.where(part); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            if x1 - x0 < MIN_SIDE or y1 - y0 < MIN_SIDE: continue
            box = ((x0 + x1) / 2 / W, (y0 + y1) / 2 / H, (x1 - x0) / W, (y1 - y0) / H)
            if name in SMAP:
                c = CLASSES.index(SMAP[name]); lines.append(f'{c} ' + ' '.join(f'{v:.6f}' for v in box)); counts[SMAP[name]] = counts.get(SMAP[name], 0) + 1
            else:
                groups.append({'group': name, 'box': [round(v, 6) for v in box]}); group_boxes[name] = group_boxes.get(name, 0) + 1
    Image.open(img_path).save(f'{OUT}/images/{stem}.jpg')
    open(f'{OUT}/labels/{stem}.txt', 'w').write('\n'.join(lines) + ('\n' if lines else ''))
    if groups: json.dump(groups, open(f'{OUT}/labels/{stem}.groups.json', 'w'))
    n_img += 1
open(f'{OUT}/data.yaml', 'w').write(f'path: {OUT}\ntrain: images\nval: images\nnames:\n' + ''.join(f'  {i}: {c}\n' for i, c in enumerate(CLASSES)))
json.dump({'groups': GROUPS, 'boxes_per_class': counts, 'group_boxes': group_boxes, 'images': n_img}, open(f'{OUT}/summary.json', 'w'), indent=1)
open(f'{OUT}/SOURCE.txt', 'w').write('Boxes made from SANPO human panoptic masks (CC BY 4.0, Google Research). TEST ONLY. See summary.json.\n')
print(f'done: {n_img} images; boxes per class {counts}; group boxes {group_boxes}')
