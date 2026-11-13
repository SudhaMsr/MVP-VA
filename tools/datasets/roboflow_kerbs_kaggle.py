# Roboflow Universe kerb sets (all CC BY 4.0) into one YOLO detection set in a Kaggle notebook.
# The Roboflow API key is read from Kaggle Secrets (Add-ons > Secrets, name ROBOFLOW_API_KEY), added by the owner by hand;
# it is never written in the notebook or committed. One line in a cell (Internet on):
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/roboflow_kerbs_kaggle.py").read())
# Polygons (segmentation sets) and keypoint boxes become plain YOLO boxes; "road" is dropped. Output: /kaggle/working/kerbs640.
import os, glob, shutil, subprocess, sys
from PIL import Image

# (workspace, project, version, {source class name (lower case): our class}, note)
SETS = [
    ('ming-chuan-university-a6nnq', 'curb-detection', 47, {'curb': 'kerb'}, 'grayscale, tiled, 90/180 deg rotated copies; use with care'),
    ('curbs', 'curb-jk8ge', 2, {'curb': 'kerb'}, '1,432 images, no augmentation'),
    ('sayan-o7dha', 'curbdetect-ogxre', 1, {'curb': 'kerb'}, '357 images, no augmentation'),
    ('alpharomeo911', 'curb-road-detection', 5, {'curb': 'kerb'}, '384 px, light rotation/shear augmentation'),
    ('van-tuyen', 'sloped-curb', 3, {'curb': 'dropped_kerb'}, 'keypoint set of sloped (dropped) kerbs; box only'),
]
CLASSES = ['kerb', 'dropped_kerb']
OUT = '/kaggle/working/kerbs640'
# Other Roboflow sets reuse this script: set RF_SETS, RF_CLASSES and RF_OUT in the cell first. A class map key '*' maps
# every source class to one of ours (e.g. {'*': 'pothole'}).
SETS = globals().get('RF_SETS', SETS)
CLASSES = globals().get('RF_CLASSES', CLASSES)
OUT = globals().get('RF_OUT', OUT)
TMP = '/kaggle/tmp/roboflow'
SIDE = 640


def to_box(vals):
    """One YOLO label line's numbers after the class id -> (cx, cy, w, h), or None.
    4 numbers: a box. Pose lines: box then keypoints (kp=True). Otherwise x,y pairs of a polygon."""
    if len(vals) == 4:
        return tuple(vals)
    if len(vals) < 6 or len(vals) % 2:
        return None
    xs, ys = vals[0::2], vals[1::2]
    x0, x1, y0, y1 = max(min(xs), 0), min(max(xs), 1), max(min(ys), 0), min(max(ys), 1)
    if x1 <= x0 or y1 <= y0:
        return None
    return ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)


def convert_line(line, names, cmap, pose):
    p = line.split()
    if not p:
        return None
    src = names[int(p[0])].lower() if int(p[0]) < len(names) else ''
    if src not in cmap and '*' not in cmap:
        return None
    if src not in cmap:
        src = '*'
    vals = [float(v) for v in p[1:]]
    box = tuple(vals[:4]) if pose else to_box(vals)
    if not box or box[2] <= 0 or box[3] <= 0:
        return None
    return f"{CLASSES.index(cmap[src])} " + ' '.join(f'{v:.6f}' for v in box)


def main():
    try:
        import roboflow  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'roboflow'], check=True)
    import yaml
    from roboflow import Roboflow
    from kaggle_secrets import UserSecretsClient
    rf = Roboflow(api_key=UserSecretsClient().get_secret('ROBOFLOW_API_KEY'))
    totals = {}
    for ws, proj, ver, cmap, note in SETS:
        tag = proj.replace('-', '_')
        p = rf.workspace(ws).project(proj)
        pose = 'keypoint' in str(getattr(p, 'type', '')).lower()
        loc = os.path.join(TMP, tag)
        if not os.path.exists(loc):
            p.version(ver).download('yolov8', location=loc)
        names = yaml.safe_load(open(os.path.join(loc, 'data.yaml')))['names']
        if isinstance(names, dict):
            names = [names[k] for k in sorted(names)]
        n_img = n_box = 0
        for split_src, split in (('train', 'train'), ('valid', 'val'), ('test', 'test')):
            for img in glob.glob(os.path.join(loc, split_src, 'images', '*')):
                stem = os.path.splitext(os.path.basename(img))[0]
                lab = os.path.join(loc, split_src, 'labels', stem + '.txt')
                lines = [convert_line(l, names, cmap, pose) for l in open(lab)] if os.path.exists(lab) else []
                lines = [l for l in lines if l]
                od = os.path.join(OUT, split)
                os.makedirs(os.path.join(od, 'images'), exist_ok=True); os.makedirs(os.path.join(od, 'labels'), exist_ok=True)
                name = f'{tag}__{stem}'
                im = Image.open(img).convert('RGB'); im.thumbnail((SIDE, SIDE))
                im.save(os.path.join(od, 'images', name + '.jpg'), 'JPEG', quality=90)
                open(os.path.join(od, 'labels', name + '.txt'), 'w').write('\n'.join(lines) + ('\n' if lines else ''))
                n_img += 1; n_box += len(lines)
        totals[f'{ws}/{proj} v{ver}'] = (n_img, n_box, note)
        print(f'{ws}/{proj} v{ver}: {n_img} images, {n_box} boxes ({note})', flush=True)
    open(os.path.join(OUT, 'data.yaml'), 'w').write(
        f'path: {OUT}\ntrain: train/images\nval: val/images\ntest: test/images\nnames:\n' + ''.join(f'  {i}: {c}\n' for i, c in enumerate(CLASSES)))
    with open(os.path.join(OUT, 'SOURCE.txt'), 'w') as f:
        f.write('Roboflow Universe sets, all CC BY 4.0 (credit each author). File names start with the source project.\n'
                'Polygons and keypoint boxes turned into YOLO boxes; "road" dropped. To be merged with the existing training data.\n')
        for k, (a, b, n) in totals.items():
            f.write(f'https://universe.roboflow.com/{k.split(" v")[0]}/dataset/{k.split(" v")[1]}  {a} images, {b} boxes  {n}\n')
    shutil.rmtree(TMP, ignore_errors=True)
    print('done:', sum(a for a, _, _ in totals.values()), 'images,', sum(b for _, b, _ in totals.values()), 'boxes')


if __name__ == '__main__' and not globals().get('NO_RUN'):
    main()
