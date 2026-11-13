# Pre-label the Bristol test photos with a SEPARATE open-vocabulary detector (Ultralytics YOLO-World), in the Phase 5
# class numbering, then draw contact sheets for review by eye. The model under test (rod2 and its successor) is never
# used here, so the test labels do not just repeat its own answers. Pre-labels are a starting point, not ground truth:
# a reviewer corrects them, and the review notes say how many photos were checked.
# Run in a Kaggle notebook with "Bristol Mapillary test set" attached (GPU optional). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/prelabel_world.py").read())
import os, glob, json, subprocess, sys, urllib.request, random
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLOWorld
from PIL import Image, ImageDraw

COMMIT = globals().get('MAP_COMMIT', 'main')
OUT = globals().get('OUT_DIR', '/kaggle/working/bristol_prelabels')
WEIGHTS = globals().get('WORLD_WEIGHTS', 'yolov8l-worldv2.pt')
CONF = globals().get('CONF', 0.20)
SHEETS = globals().get('SHEETS', 40)          # contact sheets of 6 photos for the review
CLASSES = json.loads(urllib.request.urlopen(f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/label_map.json').read())['classes']
# plain-English prompts for the open-vocabulary model, one per class (same order). Classes a camera cannot judge from a
# photo alone, or that the plan never speaks (light colour), get a neutral prompt; their boxes are reviewed like the rest.
PROMPTS = {
    'Bike': 'bicycle', 'Building': 'building', 'Car': 'car', 'Person': 'person', 'Stairs': 'stairs', 'Traffic sign': 'traffic sign',
    'Electrical Pole': 'lamp post or utility pole', 'Road': 'road', 'Motorcycle': 'motorcycle', 'Dustbin': 'rubbish bin',
    'Dog': 'dog', 'Manhole': 'manhole cover', 'Tree': 'tree', 'Guard rail': 'guard rail', 'Pedestrian crosswalk': 'zebra crossing',
    'Truck': 'truck', 'Bus': 'bus', 'Bench': 'bench', 'Traffic Cone': 'traffic cone', 'Fire hydrant': 'fire hydrant',
    'Teraffic Barrel': 'traffic barrel', 'Plant Pot': 'plant pot', 'Electrical Box': 'street cabinet', 'Chair': 'chair',
    'Bicycle Rack': 'bicycle rack', 'Bollard': 'bollard', 'Downstairs': 'stairs going down', 'Upstairs': 'stairs going up',
    'Red light': 'red traffic light', 'Green light': 'green traffic light', 'kerb': 'kerb', 'kerb_drop': 'kerb edge step down',
    'dropped_kerb': 'dropped kerb', 'pothole': 'pothole', 'pavement_crack': 'crack in pavement', 'e_scooter': 'electric scooter',
    'construction_barrier': 'construction barrier', 'tactile_paving': 'tactile paving', 'ped_signal': 'pedestrian traffic light'}
assert all(c in PROMPTS for c in CLASSES), [c for c in CLASSES if c not in PROMPTS]

root = next(p for p in glob.glob('/kaggle/input/**/bristol_mapillary_test', recursive=True) if os.path.isdir(p))
imgs = sorted(glob.glob(f'{root}/images/*.jpg'))
model = YOLOWorld(WEIGHTS); model.set_classes([PROMPTS[c] for c in CLASSES])
os.makedirs(f'{OUT}/labels', exist_ok=True); os.makedirs(f'{OUT}/sheets', exist_ok=True)
counts = {}
for k in range(0, len(imgs), 16):
    for r in model.predict(imgs[k:k + 16], conf=CONF, imgsz=640, verbose=False):
        stem = os.path.splitext(os.path.basename(r.path))[0]
        lines = []
        for c, xywhn, s in zip(r.boxes.cls.tolist(), r.boxes.xywhn.tolist(), r.boxes.conf.tolist()):
            c = int(c); lines.append(f'{c} ' + ' '.join(f'{v:.6f}' for v in xywhn) + f' {s:.3f}'); counts[CLASSES[c]] = counts.get(CLASSES[c], 0) + 1
        open(f'{OUT}/labels/{stem}.txt', 'w').write('\n'.join(lines) + ('\n' if lines else ''))
    print(f'{min(k + 16, len(imgs))}/{len(imgs)} photos pre-labelled', flush=True)

random.seed(7)
sample = random.sample(imgs, min(SHEETS * 6, len(imgs)))
for s in range(0, len(sample), 6):
    tiles = []
    for p in sample[s:s + 6]:
        im = Image.open(p).convert('RGB'); im.thumbnail((640, 640)); d = ImageDraw.Draw(im); W, H = im.size
        stem = os.path.splitext(os.path.basename(p))[0]
        for line in open(f'{OUT}/labels/{stem}.txt').read().split('\n'):
            if not line.strip(): continue
            c, x, y, w, h, sc = line.split(); c = int(c); x, y, w, h = map(float, (x, y, w, h))
            box = [(x - w / 2) * W, (y - h / 2) * H, (x + w / 2) * W, (y + h / 2) * H]
            d.rectangle(box, outline=(255, 210, 0), width=3); d.text((box[0] + 3, box[1] + 2), f'{c} {CLASSES[c]} {float(sc):.2f}', fill=(255, 255, 255))
        d.text((6, H - 14), stem, fill=(255, 255, 255)); tiles.append(im.resize((640, int(640 * H / W))))
    th = max(t.size[1] for t in tiles); sheet = Image.new('RGB', (1920, th * 2), (20, 20, 20))
    for i, t in enumerate(tiles): sheet.paste(t, ((i % 3) * 640, (i // 3) * th))
    sheet.save(f'{OUT}/sheets/sheet_{s // 6:03d}.jpg', quality=85)
json.dump({'model': WEIGHTS, 'conf': CONF, 'photos': len(imgs), 'boxes_per_class': counts, 'sheets': len(range(0, len(sample), 6)),
           'note': 'pre-labels only; the 6th field is the detector confidence; review corrections go in review.json'},
          open(f'{OUT}/summary.json', 'w'), indent=1)
print('done:', len(imgs), 'photos; boxes per class', counts)
