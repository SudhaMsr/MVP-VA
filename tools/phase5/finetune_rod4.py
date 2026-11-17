# rod4 "Bus fix": continue rod4 for a few epochs with more Bus pictures, then run gate G1 and the walker's-eye (SANPO) score.
# Why: rod4 (42 classes) passed gate G1 on every old class except Bus (17.2 -> 14.5 AP50 on 45 val boxes, limit 1 point for
# vehicles). The training set has 1,865 Bus boxes against 45,503 Car boxes, so each training picture that has a Bus in it
# is repeated BUS_COPIES more times here, then everything is fine-tuned at a low learning rate from rod4's own weights.
# It also fixes a gap in the rod4 run: the SANPO test set was skipped silently (the scorer looked for a folder called
# sanpo_yolo; the dataset has images/ and labels/ at its top), so rod4 has no walker's-eye score yet. This run scores both
# rod4 (the start) and the result on it, with the same scorer.
# Run in the SAME Kaggle notebook as rod4 (GPU T4, Internet on) with every rod4 source dataset attached (they already are),
# plus the private dataset "rod4-v2-weights" (rod4/best.pt). A commit run cannot attach new datasets, so attach it first in
# an interactive session. One line:
#   MAP_COMMIT='<commit>'; import urllib.request as u; exec(u.urlopen(f"https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{MAP_COMMIT}/tools/phase5/finetune_rod4.py").read())
# Writes /kaggle/working/rod4b/: best.pt, rod4b_416.onnx, report_build.json, gate_g1.json, baseline_rod4_sanpo.json,
# baseline_rod4b.json. It REPORTS the gate; it never swaps a model into the app.
import os, re, glob, json, shutil, urllib.request, subprocess, sys
COMMIT = globals().get('MAP_COMMIT', 'main')
BASE = f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/'
NAME = 'rod4b'
OUT = f'/kaggle/working/{NAME}'
EPOCHS = globals().get('EPOCHS', 8)              # about 6.5 minutes each on a T4 x2
BUS_COPIES = globals().get('BUS_COPIES', 2)      # extra copies of each training picture that has a Bus box
BATCH, IMGSZ = globals().get('BATCH', 64), 416
os.makedirs(OUT, exist_ok=True)
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLO

LM = json.loads(urllib.request.urlopen(BASE + 'label_map.json').read())
CLASSES = LM['classes']
BUS = CLASSES.index('Bus')


def repeat_class(root, cls_id, copies, tag):
    """Add `copies` extra copies of every TRAIN picture (and its label file) that has a box of class cls_id. Pictures are
    symlinks, so no disk is used. Copies are named <stem>.<tag><k>, and a stem that already ends in .<tag><digits> is skipped, so
    running it twice does not multiply them. Returns the number of pictures repeated."""
    img_dir, lab_dir = f'{root}/images/train', f'{root}/labels/train'
    by_stem = {os.path.splitext(f)[0]: f for f in os.listdir(img_dir)}
    n = 0
    for lab in [f for f in os.listdir(lab_dir) if f.endswith('.txt')]:
        stem = lab[:-4]
        if re.search(rf'\.{tag}\d+$', stem) or stem not in by_stem: continue
        if not any(ln.split()[:1] == [str(cls_id)] for ln in open(f'{lab_dir}/{lab}') if ln.strip()): continue
        ext = os.path.splitext(by_stem[stem])[1]
        for k in range(copies):
            dst = f'{img_dir}/{stem}.{tag}{k}{ext}'
            if not os.path.lexists(dst): os.symlink(os.path.realpath(f'{img_dir}/{by_stem[stem]}'), dst)
            shutil.copy(f'{lab_dir}/{lab}', f'{lab_dir}/{stem}.{tag}{k}.txt')
        n += 1
    return n


# 0. inputs: rod4's own weights, rod2 (for the pseudo-labels and the gate), the SANPO test set
START = next(p for p in glob.glob('/kaggle/input/**/rod4/best.pt', recursive=True))
ROD2 = next(p for p in glob.glob('/kaggle/input/**/rod2_best.pt', recursive=True))
SANPO = next(p for p in glob.glob('/kaggle/input/**/sanpo-test-boxes-phase5*', recursive=True) if os.path.isdir(f'{p}/images'))
print('start', START, '| rod2', ROD2, '| sanpo', SANPO, flush=True)

# 1. the same training set as rod4 (same label map, same commit: rebuilt, because /kaggle/working is not kept between runs)
g = {'MAP_COMMIT': COMMIT, 'PSEUDO': True, 'ROD2_PATH': ROD2, 'OUT_DIR': '/kaggle/working/p5'}
exec(urllib.request.urlopen(BASE + 'build_trainset.py').read(), g)
shutil.copy('/kaggle/working/p5/report.json', f'{OUT}/report_build.json')
n_rep = repeat_class('/kaggle/working/p5', BUS, BUS_COPIES, 'rep')
for cache in glob.glob('/kaggle/working/p5/labels/*.cache'): os.remove(cache)
print(f'Bus: {n_rep} training pictures repeated {BUS_COPIES} more times', flush=True)
data = '/kaggle/working/p5/data.yaml'

# 2. fine-tune from rod4 at a low learning rate (rod4's stage-2 rate was 0.0005)
YOLO(START).train(data=data, imgsz=IMGSZ, epochs=EPOCHS, batch=BATCH, optimizer='AdamW', lr0=0.0002, warmup_epochs=1,
                  close_mosaic=2, project=OUT, name='s3', patience=0, exist_ok=True, workers=4, plots=False)
best = f'{OUT}/s3/weights/best.pt'; shutil.copy(best, f'{OUT}/best.pt')

# 3. gate G1 on the Phase 2 val pictures (same code as train_rod3.py: rod2 against the new model, same scorer)
g1 = '/kaggle/working/g1'
for sub in ('images', 'labels'): os.makedirs(f'{g1}/{sub}', exist_ok=True)
for p in glob.glob('/kaggle/working/p5/images/val/phase2__*'):
    stem = os.path.splitext(os.path.basename(p))[0]
    for src, dst in ((p, f'{g1}/images/{os.path.basename(p)}'), (f'/kaggle/working/p5/labels/val/{stem}.txt', f'{g1}/labels/{stem}.txt')):
        if not os.path.lexists(dst): os.symlink(os.path.realpath(src), dst)
ev = urllib.request.urlopen(BASE + 'baseline_eval.py').read()
for model, tag in ((ROD2, 'rod2_g1'), (best, f'{NAME}_g1')):
    exec(ev, {'MAP_COMMIT': COMMIT, 'MODEL_PATH': model, 'TAG': tag, 'OUT_DIR': OUT, 'ONLY_TESTSETS': {'phase2_val': g1}})
old = json.load(open(f'{OUT}/baseline_rod2_g1.json'))['testsets']['phase2_val']['per_class']
new = json.load(open(f'{OUT}/baseline_{NAME}_g1.json'))['testsets']['phase2_val']['per_class']
rows, fail = {}, []
for n, o in old.items():
    if not o.get('scored') or 'ap50' not in o: continue
    drop = round((o['ap50'] - new.get(n, {}).get('ap50', 0.0)) * 100, 1)
    limit = 1 if n in ('Person', 'Car', 'Truck', 'Bus', 'Motorcycle', 'Bike') else 2
    rows[n] = {'val_boxes': o['gt'], 'rod2_ap50': o['ap50'], f'{NAME}_ap50': new.get(n, {}).get('ap50'), 'drop_points': drop, 'limit': limit}
    if drop > limit: fail.append(n)
json.dump({'G1_pass': not fail, 'failed_classes': fail, 'classes': rows}, open(f'{OUT}/gate_g1.json', 'w'), indent=1)
print('G1', 'PASS' if not fail else f'FAIL: {fail}'); [print(f'  {k:22s} {v}') for k, v in rows.items()]

# 4. the walker's-eye (SANPO) score for rod4 (the start) and the result; the first time this has been run for rod4
for model, tag in ((START, 'rod4_sanpo'), (best, NAME)):
    exec(ev, {'MAP_COMMIT': COMMIT, 'MODEL_PATH': model, 'TAG': tag, 'OUT_DIR': OUT, 'ONLY_TESTSETS': {'sanpo': SANPO}})
onnx = YOLO(best).export(format='onnx', imgsz=IMGSZ, opset=12, simplify=True)
shutil.copy(onnx, f'{OUT}/{NAME}_416.onnx')
print('done:', OUT)
