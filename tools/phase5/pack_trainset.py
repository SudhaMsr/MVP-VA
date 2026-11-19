# Step 5b: pack the Phase 5 training set built by build_trainset.py into ONE tar of pictures resized to 416 px (long side),
# so the GPU session reads local disk instead of 24 slow mounts, and does not rebuild the set (about an hour) every run.
# This is a TRAINING CACHE only: the original pictures in the source datasets are untouched. Training resizes every picture to
# 416 px (imgsz=416) anyway, so nothing the model sees is lost; pictures already <= 416 px are copied unchanged.
# Run in the SAME CPU notebook session, right after build_trainset.py (it needs that cell's names: SOURCES, LM, CLASSES,
# UNLEARNED, OUT). One line:
#   PACK_NAME='phase5-trainset-416-v1'; import urllib.request as u; exec(u.urlopen(f"https://raw.githubusercontent.com/SudhaMsr/MVP-VA/{MAP_COMMIT}/tools/phase5/pack_trainset.py").read())
# Writes /kaggle/working/pack/p5_416.dat (images/{train,val,test}, labels/..., data.yaml, report.json, pack_meta.json) and, if
# KAGGLE_UPLOAD is true, uploads it as the PRIVATE dataset sudharanimsr/<PACK_NAME>. pack_meta.json carries what pseudo_label.py
# needs (which classes each source labels itself, which classes rod2 never learned), so the GPU session needs no rebuild.
import os, glob, json, shutil, tarfile, collections
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
ROOT = globals().get('OUT_DIR', '/kaggle/working/p5')
PK = '/kaggle/working/pack'; STAGE = f'{PK}/p5'
PACK_NAME = globals().get('PACK_NAME', 'phase5-trainset-416-v1')
LONG = 416
shutil.rmtree(STAGE, ignore_errors=True)
for sp in ('train', 'val', 'test'):
    os.makedirs(f'{STAGE}/images/{sp}', exist_ok=True); os.makedirs(f'{STAGE}/labels/{sp}', exist_ok=True)
jobs = [(sp, f) for sp in ('train', 'val', 'test') for f in os.listdir(f'{ROOT}/images/{sp}')]
def one(job):
    sp, f = job; stem = os.path.splitext(f)[0]
    try:
        im = Image.open(f'{ROOT}/images/{sp}/{f}')
        if max(im.size) > LONG: im.draft('RGB', (LONG, LONG))          # JPEG: decode at reduced size, much faster
        im = im.convert('RGB'); W, H = im.size
        if max(W, H) > LONG:
            s = LONG / max(W, H); im = im.resize((max(1, round(W * s)), max(1, round(H * s))), Image.BILINEAR)
        im.save(f'{STAGE}/images/{sp}/{stem}.jpg', quality=92)
        shutil.copy(f'{ROOT}/labels/{sp}/{stem}.txt', f'{STAGE}/labels/{sp}/{stem}.txt')   # YOLO labels are normalised: unchanged
        return None
    except Exception as e:
        return f'{sp}/{f}: {e}'
errs = []
with ThreadPoolExecutor(4) as ex:
    for k, r in enumerate(ex.map(one, jobs)):
        if r: errs.append(r)
        if k % 5000 == 0: print(f'packed {k}/{len(jobs)}', flush=True)
for sp in ('train', 'val', 'test'):
    for d in ('images', 'labels'):
        print(sp, d, len(os.listdir(f'{STAGE}/{d}/{sp}')))
print('errors', len(errs), errs[:5])
def _own(m):
    v = [x for k, x in m.items() if not k.startswith('_') and isinstance(x, str)] + list(m.get('_ids', {}).values())
    v += [x for d in m.get('_ids_by_folder', {}).values() for x in d.values()]
    return sorted({CLASSES.index(x) for x in v})
meta = {'classes': CLASSES, 'unlearned': sorted(UNLEARNED), 'own_classes': {k: _own(LM['sources'][k]) for k in SOURCES.values() if k in LM['sources']},
        'map_commit': globals().get('MAP_COMMIT', 'main'), 'errors': len(errs)}
json.dump(meta, open(f'{STAGE}/pack_meta.json', 'w'), indent=1)
shutil.copy(f'{ROOT}/report.json', f'{STAGE}/report.json')
open(f'{STAGE}/data.yaml', 'w').write('path: /kaggle/working/p5\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n' + ''.join(f'  {i}: {c}\n' for i, c in enumerate(CLASSES)))
os.makedirs(f'{PK}/up', exist_ok=True)
tar = f'{PK}/up/p5_416.dat'   # NOT .tar: Kaggle unpacks archives into 200,000 small files (slow to read); a .dat stays one file
with tarfile.open(tar, 'w') as t: t.add(STAGE, arcname='p5')
print('tar', round(os.path.getsize(tar) / 1e9, 2), 'GB')
shutil.rmtree(STAGE)
if globals().get('KAGGLE_UPLOAD', True):
    import kagglehub
    kagglehub.dataset_upload(f'sudharanimsr/{PACK_NAME}', f'{PK}/up')   # private by default
    print('uploaded sudharanimsr/' + PACK_NAME)
