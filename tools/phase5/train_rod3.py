# Step 6 and 7 of the final MVP training plan: train rod3 (40 classes) from rod2_best.pt, then check gate G1 and score it
# on the SANPO walker's-eye test set. Same two-stage recipe as Phase 2 (tools/phase2/train_colab.py): a frozen-backbone
# stage, then a full fine-tune; 416 px, the size the app runs this lane at.
# Run in a Kaggle notebook, GPU T4, Internet on, with every source dataset, "rod2 phase2 best pt" and "SANPO test boxes
# Phase5" attached (attach them in an interactive session first; a commit run cannot attach new datasets). One line:
#   MAP_COMMIT='<commit>'; import urllib.request as u; exec(u.urlopen(f"https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{MAP_COMMIT}/tools/phase5/train_rod3.py").read())
# Writes /kaggle/working/rod3/: best.pt, rod3_416.onnx, report_build.json (from the builder), gate_g1.json, baseline_rod3.json.
# G1 (old classes): on the Phase 2 val pictures, no old class may drop more than 2 AP50 points (Person and the vehicles: 1),
# counting only classes with at least 30 val boxes. The script REPORTS the gate; it never swaps a model into the app.
import os, glob, json, shutil, urllib.request, subprocess, sys
COMMIT = globals().get('MAP_COMMIT', 'main')
BASE = f'https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{COMMIT}/tools/phase5/'
NAME = globals().get('MODEL_NAME', 'rod3')  # 'rod4' for the 42-class run; only changes file and folder names
OUT = globals().get('RUN_DIR', f'/kaggle/working/{NAME}')
EPOCHS1, EPOCHS2 = globals().get('EPOCHS1', 10), globals().get('EPOCHS2', 35)
IMGSZ, BATCH = 416, globals().get('BATCH', 64)
os.makedirs(OUT, exist_ok=True)
try:
    import ultralytics  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'ultralytics'], check=True)
from ultralytics import YOLO

ROD2 = next(p for p in glob.glob('/kaggle/input/**/rod2_best.pt', recursive=True))
# 1. training set. Preferred: the packed 416-px set (private dataset "phase5-trainset-416-*", made by pack_trainset.py): untar to
#    local disk, add rod2 pseudo-labels (pseudo_label.py), repeat Bus pictures. Fallback: rebuild from the 24 mounts (slow, about an hour).
packs = sorted(glob.glob('/kaggle/input/**/p5_416.tar', recursive=True))
if packs and not os.path.exists('/kaggle/working/p5/data.yaml'):
    subprocess.run(['tar', '-xf', packs[-1], '-C', '/kaggle/working'], check=True)
    print('unpacked', packs[-1], flush=True)
if os.path.exists('/kaggle/working/p5/pack_meta.json'):
    if globals().get('PSEUDO', True) and not os.path.exists('/kaggle/working/p5/pseudo_report.json'):
        exec(urllib.request.urlopen(BASE + 'pseudo_label.py').read(), {'ROD2_PATH': ROD2, 'PACK_ROOT': '/kaggle/working/p5'})
    BUS_COPIES = globals().get('BUS_COPIES', 2)  # Bus has few boxes (rod4 lost 2.7 AP50 on it); repeat each Bus picture
    if BUS_COPIES and not glob.glob('/kaggle/working/p5/images/train/*.bus0.jpg'):
        lab_dir, img_dir = '/kaggle/working/p5/labels/train', '/kaggle/working/p5/images/train'
        bus = json.load(open('/kaggle/working/p5/pack_meta.json'))['classes'].index('Bus'); n = 0
        for lab in [f for f in os.listdir(lab_dir) if f.endswith('.txt')]:
            if not any(ln.split()[:1] == [str(bus)] for ln in open(f'{lab_dir}/{lab}') if ln.strip()): continue
            stem = lab[:-4]; n += 1
            for k in range(BUS_COPIES):
                os.symlink(os.path.realpath(f'{img_dir}/{stem}.jpg'), f'{img_dir}/{stem}.bus{k}.jpg')
                shutil.copy(f'{lab_dir}/{lab}', f'{lab_dir}/{stem}.bus{k}.txt')
        print(f'Bus: {n} training pictures repeated {BUS_COPIES} more times', flush=True)
    shutil.copy('/kaggle/working/p5/report.json', f'{OUT}/report_build.json')
else:
    g = {'MAP_COMMIT': COMMIT, 'PSEUDO': globals().get('PSEUDO', True), 'ROD2_PATH': ROD2, 'OUT_DIR': '/kaggle/working/p5'}
    exec(urllib.request.urlopen(BASE + 'build_trainset.py').read(), g)
    shutil.copy('/kaggle/working/p5/report.json', f'{OUT}/report_build.json')
data = '/kaggle/working/p5/data.yaml'

# 2. train: stage 1 frozen backbone (new head learns 40 classes), stage 2 everything at a low learning rate
YOLO(ROD2).train(data=data, imgsz=IMGSZ, epochs=EPOCHS1, batch=BATCH, freeze=10, lr0=0.002, project=OUT, name='s1',
                 patience=0, exist_ok=True, workers=4, plots=False)
YOLO(f'{OUT}/s1/weights/best.pt').train(data=data, imgsz=IMGSZ, epochs=EPOCHS2, batch=BATCH, optimizer='AdamW', lr0=0.0005,
                                        project=OUT, name='s2', patience=10, exist_ok=True, workers=4, plots=False)
best = f'{OUT}/s2/weights/best.pt'; shutil.copy(best, f'{OUT}/best.pt')

# 3. gate G1 on the Phase 2 val pictures only (neither model trained on them), scored by baseline_eval.py so rod2 and rod3
#    are measured the same way (AP50 per class at IoU 0.5; classes with fewer than 30 val boxes are not judged)
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

# 4. the same walker's-eye score as the rod2 baseline, then ONNX for the app (added silently, by a separate PR)
exec(ev, {'MAP_COMMIT': COMMIT, 'MODEL_PATH': best, 'TAG': NAME, 'OUT_DIR': OUT})
onnx = YOLO(best).export(format='onnx', imgsz=IMGSZ, opset=12, simplify=True)
shutil.copy(onnx, f'{OUT}/{NAME}_416.onnx')
print('done:', OUT)
