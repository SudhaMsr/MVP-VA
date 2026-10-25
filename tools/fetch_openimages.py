#!/usr/bin/env python3
"""Download the Open Images V7 pictures that matter for Vision Assist, as a YOLO training set.

Run this on your own computer or in Google Colab (it needs internet access to storage.googleapis.com and
open-images-dataset.s3.amazonaws.com). Standard library only.

    python3 tools/fetch_openimages.py --out oi_vision --per-class 600

It writes:
    oi_vision/images/{train,val}/<id>.jpg      the pictures
    oi_vision/labels/{train,val}/<id>.txt      YOLO boxes: class x_center y_center width height (0 to 1)
    oi_vision/data.yaml                        class list for ultralytics
    oi_vision/manifest.csv                     image id, licence, author, original url (keep it: CC BY needs credit)
    oi_vision/report.txt                       which wanted classes were found, how many pictures and boxes each

Open Images boxes are CC BY 4.0 and the pictures are mostly CC BY 2.0. Keep manifest.csv with the dataset.
Open Images has NO kerb, step-down, A-board or e-scooter class. Those still need your own footage.
"""
import argparse, csv, io, os, random, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = 'https://storage.googleapis.com/openimages'
S3 = 'https://open-images-dataset.s3.amazonaws.com'

# our class name -> Open Images display names that mean it (first one found wins; all that exist are merged)
WANTED = {
    'stairs': ['Stairs'],
    'bollard': ['Bollard'],
    'pole': ['Street light', 'Lamp post', 'Utility pole'],
    'ashcan': ['Trash can', 'Waste container'],
    'bench': ['Bench'],
    'fire_hydrant': ['Fire hydrant'],
    'postbox': ['Mailbox'],
    'wheelchair': ['Wheelchair'],
    'pram': ['Stroller', 'Baby carriage'],
    'scooter': ['Scooter', 'Segway'],
    'skateboard': ['Skateboard'],
    'barrier': ['Fence', 'Barricade'],
    'cone': ['Traffic cone', 'Cone'],
    'door': ['Door', 'Gate'],
    'ped_signal': ['Traffic light'],
    'plant_pot': ['Flowerpot', 'Houseplant'],
    'parking_meter': ['Parking meter'],
}
MIN_AREA = 0.004  # ignore boxes smaller than 0.4% of the picture: too small to matter


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def stream_lines(url):
    r = urllib.request.urlopen(url, timeout=120)
    for raw in io.TextIOWrapper(r, encoding='utf-8', newline=''):
        yield raw


def read_classes(text):
    """oidv7-class-descriptions-boxable.csv: LabelName,DisplayName -> {lower display name: mid}"""
    return {row[1].strip().lower(): row[0] for row in csv.reader(io.StringIO(text)) if len(row) >= 2}


def resolve(wanted, mids):
    """-> ({mid: our class}, [our classes with no Open Images match]). Names are matched ignoring case."""
    mid_to_ours, missing = {}, []
    for ours, names in wanted.items():
        hit = [mids[n.lower()] for n in names if n.lower() in mids]
        if not hit:
            missing.append(ours)
        for m in hit:
            mid_to_ours[m] = ours
    return mid_to_ours, missing


def box_row_ok(row, header):
    """Keep clear, single, real-world objects: not groups, not drawings, not 'occluded' crowds."""
    g = lambda k: row[header[k]]
    if g('IsGroupOf') == '1' or g('IsDepiction') == '1':
        return False
    w, h = float(g('XMax')) - float(g('XMin')), float(g('YMax')) - float(g('YMin'))
    return w > 0 and h > 0 and w * h >= MIN_AREA


def yolo_line(cls_idx, row, header):
    x0, x1, y0, y1 = (float(row[header[k]]) for k in ('XMin', 'XMax', 'YMin', 'YMax'))
    return f'{cls_idx} {(x0 + x1) / 2:.6f} {(y0 + y1) / 2:.6f} {x1 - x0:.6f} {y1 - y0:.6f}'


def collect(lines, mid_to_ours, order, per_class, seed=1):
    """lines: an iterable of annotation csv lines. -> {image id: [yolo lines]}, with at most per_class images per class."""
    reader = csv.reader(lines)
    header = {name: i for i, name in enumerate(next(reader))}
    by_image, per = {}, {c: set() for c in order}
    rng = random.Random(seed)
    for row in reader:
        mid = row[header['LabelName']]
        if mid not in mid_to_ours or not box_row_ok(row, header):
            continue
        ours = mid_to_ours[mid]
        img = row[header['ImageID']]
        if img not in per[ours] and len(per[ours]) >= per_class:
            continue
        per[ours].add(img)
        by_image.setdefault(img, []).append(yolo_line(order.index(ours), row, header))
    return by_image, per


META = {  # per-picture licence and author files (best effort: if a link has moved, the manifest just has no licence column)
    'validation': 'https://storage.googleapis.com/openimages/2018_04/validation/validation-images-with-rotation.csv',
    'test': 'https://storage.googleapis.com/openimages/2018_04/test/test-images-with-rotation.csv',
    'train': 'https://storage.googleapis.com/openimages/2018_04/train/train-images-with-rotation.csv',
}


def write_manifest(out, by_image, saved):
    want = {i: by_image[i][0] for i in saved}
    meta = {}
    for split in sorted(set(want.values())):
        try:
            reader = csv.reader(stream_lines(META[split]))
            h = {n: k for k, n in enumerate(next(reader))}
            for r in reader:
                if r[h['ImageID']] in want:
                    meta[r[h['ImageID']]] = (r[h['License']], r[h['Author']], r[h['OriginalLandingURL']])
        except Exception as e:
            print('could not read licence details for', split, '-', e, '(see https://storage.googleapis.com/openimages/web/download_v7.html)')
    with open(os.path.join(out, 'manifest.csv'), 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['image_id', 'split', 'license', 'author', 'url'])
        for i in sorted(want):
            w.writerow([i, want[i], *meta.get(i, ('', '', ''))])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='oi_vision')
    ap.add_argument('--per-class', type=int, default=600, help='most pictures to take for each class')
    ap.add_argument('--val-fraction', type=float, default=0.1)
    ap.add_argument('--splits', default='validation,test,train', help='train is a 1.2 GB annotation file, read as a stream')
    ap.add_argument('--workers', type=int, default=16)
    ap.add_argument('--dry-run', action='store_true', help='only report what would be downloaded')
    a = ap.parse_args()

    mids = read_classes(fetch(f'{BASE}/v7/oidv7-class-descriptions-boxable.csv').decode('utf-8'))
    mid_to_ours, missing = resolve(WANTED, mids)
    order = [c for c in WANTED if c not in missing]
    print('classes found:', order); print('not in Open Images (will need your own footage):', missing)

    by_image, per = {}, {c: set() for c in order}
    for split in a.splits.split(','):
        # Open Images V7 reuses the V6 box files
        url = f'{BASE}/v6/oidv6-{split}-annotations-bbox.csv'
        print('reading', url)
        got, p = collect(stream_lines(url), mid_to_ours, order, a.per_class)
        for img, ls in got.items():
            by_image.setdefault(img, (split, []))[1].extend(ls)
        for c in order:
            per[c] |= p[c]
        if all(len(per[c]) >= a.per_class for c in order):
            break

    report = [f'{c}: {len(per[c])} pictures' for c in order] + [f'no Open Images class: {c}' for c in missing]
    print('\n'.join(report))
    if a.dry_run:
        return
    for sub in ('images/train', 'images/val', 'labels/train', 'labels/val'):
        os.makedirs(os.path.join(a.out, sub), exist_ok=True)
    ids = sorted(by_image)
    random.Random(2).shuffle(ids)
    val = set(ids[: int(len(ids) * a.val_fraction)])

    def get(img):
        split = by_image[img][0]
        part = 'val' if img in val else 'train'
        try:
            data = fetch(f'{S3}/{split}/{img}.jpg')
        except Exception as e:  # a few pictures have been taken down
            return img, None, str(e)
        open(os.path.join(a.out, 'images', part, img + '.jpg'), 'wb').write(data)
        open(os.path.join(a.out, 'labels', part, img + '.txt'), 'w').write('\n'.join(by_image[img][1]) + '\n')
        return img, part, None

    with ThreadPoolExecutor(a.workers) as ex:
        results = list(ex.map(get, ids))
    bad = [r for r in results if r[1] is None]
    open(os.path.join(a.out, 'data.yaml'), 'w').write(
        f'path: {os.path.abspath(a.out)}\ntrain: images/train\nval: images/val\nnames:\n' + ''.join(f'  {i}: {c}\n' for i, c in enumerate(order)))
    open(os.path.join(a.out, 'report.txt'), 'w').write('\n'.join(report) + f'\n{len(ids) - len(bad)} pictures saved, {len(bad)} failed\n')
    write_manifest(a.out, by_image, [i for i, part, _ in results if part])
    print(f'{len(ids) - len(bad)} pictures saved, {len(bad)} failed. Keep manifest.csv with the pictures (licence credit).')


if __name__ == '__main__':
    sys.exit(main())
