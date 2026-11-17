# Make a small labels-only Kaggle dataset from the Vistas surface polygons already in "vistas-roads-yolo640" (labels_seg/), so
# the rod4 builder can turn them into boxes. No pictures are copied: the builder finds them by file name in vistas-roads-yolo640
# ('_images_also' in tools/phase5/label_map.json). NON-COMMERCIAL (Mapillary Vistas). Run in a Kaggle notebook (CPU) with
# vistas-roads-yolo640 attached. One line:
#   UPLOAD_AS='vistas-surfaces-labels'; import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/phase5/vistas_surface_labels_kaggle.py").read())
import os, glob, shutil
OUT = globals().get('OUT_DIR', '/kaggle/working/vistas_surface_labels')
root = os.path.dirname(next(p for p in glob.glob('/kaggle/input/**/data_seg.yaml', recursive=True)))
print('Vistas root:', root)
shutil.rmtree(OUT, ignore_errors=True); n = {}
for split in ('train', 'val'):
    src = f'{root}/{split}/labels_seg'
    if not os.path.isdir(src): print('missing', src); continue
    os.makedirs(f'{OUT}/{split}/labels', exist_ok=True)
    for f in os.listdir(src):
        if f.endswith('.txt'): shutil.copy(f'{src}/{f}', f'{OUT}/{split}/labels/{f}')
    n[split] = len(os.listdir(f'{OUT}/{split}/labels'))
shutil.copy(f'{root}/data_seg.yaml', f'{OUT}/data.yaml')  # class names for the polygon labels
open(f'{OUT}/SOURCE.txt', 'w').write('Polygon labels from Mapillary Vistas v2.0 (CC BY-NC-SA 4.0 + Mapillary Research Use Licence). NON-COMMERCIAL. Keep private.\n')
print('label files:', n, '\n' + open(f'{OUT}/data.yaml').read())
if globals().get('UPLOAD_AS'):
    import kagglehub
    kagglehub.dataset_upload(f"sudharanimsr/{globals()['UPLOAD_AS']}", OUT); print('uploaded private:', globals()['UPLOAD_AS'])
