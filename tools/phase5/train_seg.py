# Surface segmentation PILOT (architecture experiment, NOT a release candidate).
# Trains a small YOLO segmentation model on the Mapillary Vistas polygons in the private Kaggle dataset
# "vistas-roads-yolo640" (labels_seg/ + data_seg.yaml, written by tools/datasets/vistas_kaggle.py with WANT_SEG).
# LICENCE: Vistas is non-commercial and confidential, so anything trained here can never ship. Weights are prefixed
# "ncseg_" and must never be copied into docs/models/. Nothing here touches the app or adds speech.
# Test data stays independent: Vistas is the only training data; the SANPO walker frames are only for scoring.
# Class set is deliberately small (KEEP): road, sidewalk, curb, curb_cut. Do not expand it without a reason; class-count
# creep is what produced rounds 3 to 5 of the detection model.
# Run in a Kaggle notebook, GPU T4, Internet on (to fetch yolo11n-seg.pt), with "vistas-roads-yolo640" attached:
#   MAP_COMMIT='<commit>'; import urllib.request as u; exec(u.urlopen(f"https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{MAP_COMMIT}/tools/phase5/train_seg.py").read())
# Optional globals before the exec line: KEEP, EPOCHS, BATCH (default 16: seg at 640 px is heavy), IMGSZ, BASE_WEIGHTS, MAX_TRAIN,
# RUN_DIR, PREP_ONLY, UPLOAD_AS (a private Kaggle dataset name, e.g. 'ncseg-surface-pilot-v1').
# Smoke test first (about 15 min): EPOCHS=1; MAX_TRAIN=300. Then a committed run (Save & Run All) for the real one.
# Images are symlinked and labels are written into /kaggle/working, so the read-only /kaggle/input never needs a labels.cache.
# Writes RUN_DIR (default /kaggle/working/seg): best.pt, ncseg_best_416.onnx, ncseg_best_640.onnx, report_seg.json.
import os, glob, json, shutil, subprocess, sys

def read_names(yaml_path):
    """names: block of a YOLO data yaml -> {index: name} (the file is simple: '  0: road')."""
    names, on = {}, False
    for line in open(yaml_path).read().splitlines():
        if line.startswith('names:'): on = True; continue
        if on and line.startswith(' ') and ':' in line:
            k, v = line.strip().split(':', 1); names[int(k)] = v.strip()
        elif on and line.strip() and not line.startswith(' '): break
    return names

def remap_label_text(text, remap):
    """Keep only polygons of wanted classes, renumbered. A polygon line is: class x1 y1 x2 y2 ... (at least 3 points)."""
    out = []
    for line in text.splitlines():
        p = line.split()
        if len(p) >= 7 and p[0].isdigit() and int(p[0]) in remap:
            out.append(' '.join([str(remap[int(p[0])])] + p[1:]))
    return '\n'.join(out) + ('\n' if out else '')

def prepare(src_root, out_dir, keep, max_train=None):
    names = read_names(os.path.join(src_root, 'data_seg.yaml'))
    inv = {v: k for k, v in names.items()}
    missing = [n for n in keep if n not in inv]
    if missing: raise SystemExit(f'classes not in data_seg.yaml: {missing}; it has {sorted(inv)}')
    remap = {inv[n]: i for i, n in enumerate(keep)}
    counts = {}
    for split in ('train', 'val'):
        imgs = sorted(glob.glob(os.path.join(src_root, split, 'images', '*.jpg')))
        if split == 'train' and max_train: imgs = imgs[:max_train]
        os.makedirs(f'{out_dir}/{split}/images', exist_ok=True); os.makedirs(f'{out_dir}/{split}/labels', exist_ok=True)
        n_img = n_poly = n_empty = 0
        per = {n: 0 for n in keep}
        for p in imgs:
            stem = os.path.splitext(os.path.basename(p))[0]
            lab = os.path.join(src_root, split, 'labels_seg', stem + '.txt')
            text = remap_label_text(open(lab).read(), remap) if os.path.exists(lab) else ''
            dst = f'{out_dir}/{split}/images/{stem}.jpg'
            if not os.path.lexists(dst): os.symlink(os.path.realpath(p), dst)
            open(f'{out_dir}/{split}/labels/{stem}.txt', 'w').write(text)
            n_img += 1; n_empty += (text == '')
            for line in text.splitlines():
                n_poly += 1; per[keep[int(line.split()[0])]] += 1
        counts[split] = {'images': n_img, 'polygons': n_poly, 'images_without_kept_classes': n_empty, 'per_class': per}
    with open(f'{out_dir}/data.yaml', 'w') as f:
        f.write(f"path: {out_dir}\ntrain: train/images\nval: val/images\nnames:\n" + ''.join(f'  {i}: {n}\n' for i, n in enumerate(keep)))
    return counts

if __name__ == '__main__' or 'MAP_COMMIT' in globals():
    KEEP = globals().get('KEEP') or ['road', 'sidewalk', 'curb', 'curb_cut']
    OUT = globals().get('RUN_DIR', '/kaggle/working/seg')
    DATA = '/kaggle/working/seg_data'
    src = next((os.path.dirname(p) for p in glob.glob('/kaggle/input/**/data_seg.yaml', recursive=True)), None)
    if src is None: raise SystemExit('attach the dataset vistas-roads-yolo640 (data_seg.yaml not found under /kaggle/input)')
    os.makedirs(OUT, exist_ok=True)
    counts = prepare(src, DATA, KEEP, globals().get('MAX_TRAIN'))
    print(json.dumps(counts, indent=1))
    json.dump({'keep': KEEP, 'data': counts, 'licence': 'Mapillary Vistas non-commercial: ncseg_ weights must never ship'},
              open(f'{OUT}/report_seg.json', 'w'), indent=1)
    if not globals().get('PREP_ONLY'):
        try:
            import ultralytics  # noqa: F401
        except ImportError:
            subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
        from ultralytics import YOLO
        IMGSZ, BATCH, EPOCHS = globals().get('IMGSZ', 640), globals().get('BATCH', 16), globals().get('EPOCHS', 40)
        model = YOLO(globals().get('BASE_WEIGHTS', 'yolo11n-seg.pt'))
        model.train(data=f'{DATA}/data.yaml', task='segment', imgsz=IMGSZ, epochs=EPOCHS, batch=BATCH, project=OUT, name='run',
                    patience=10, exist_ok=True, workers=4, plots=False)
        best = f'{OUT}/run/weights/best.pt'
        shutil.copy(best, f'{OUT}/ncseg_best.pt')
        m = YOLO(best)
        val = m.val(data=f'{DATA}/data.yaml', imgsz=IMGSZ, batch=BATCH, plots=False)
        report = json.load(open(f'{OUT}/report_seg.json'))
        report['val_mask_ap50_per_class'] = {KEEP[int(c)]: float(v) for c, v in zip(val.seg.ap_class_index, val.seg.ap50)}
        report['val_mask_map50'] = float(val.seg.map50)
        for size in (416, 640):
            onnx = YOLO(best).export(format='onnx', imgsz=size, opset=12, simplify=True)
            shutil.copy(onnx, f'{OUT}/ncseg_best_{size}.onnx')
        json.dump(report, open(f'{OUT}/report_seg.json', 'w'), indent=1)
        # keep the output small: only the weights, exports, results.csv, args.yaml and the report
        for f in ('results.csv', 'args.yaml'):
            if os.path.exists(f'{OUT}/run/{f}'): shutil.copy(f'{OUT}/run/{f}', f'{OUT}/{f}')
        shutil.rmtree(f'{OUT}/run', ignore_errors=True)
        open(f'{OUT}/SOURCE.txt', 'w').write(
            'Surface segmentation PILOT weights, trained on Mapillary Vistas v2.0 (CC BY-NC-SA 4.0 + Mapillary Research Use Licence).\n'
            'NON-COMMERCIAL and CONFIDENTIAL: the weights inherit these terms. They can NEVER ship in the app or any product.\n'
            'Credit: Mapillary. Experiment only (does segmentation beat boxes for kerbs?). Keep this dataset private.\n')
        if globals().get('UPLOAD_AS'):
            try:
                import kagglehub
                kagglehub.dataset_upload(f"sudharanimsr/{globals()['UPLOAD_AS']}", OUT)
                print('uploaded private:', globals()['UPLOAD_AS'])
            except Exception as e:
                print('upload failed (save the output as a private dataset by hand):', type(e).__name__, e)
        print('mask mAP50 on Vistas val', report['val_mask_map50'], report['val_mask_ap50_per_class'])
        print('done: weights are NON-COMMERCIAL (Vistas). Never copy into docs/models/.')
