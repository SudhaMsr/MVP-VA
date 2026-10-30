# Phase 2 fine-tune in Google Colab (Runtime > Change runtime type > GPU). Paste each block into its own cell.
# You need: phase2_data.zip (made by prepare.py) and weights/rod_best.pt (from the repo) uploaded to Google Drive/MyDrive/phase2/.
# Nothing here retrains from scratch: it starts from rod_best.pt and keeps its 25 classes, adding five new ones.
#
# ---- Cell 1: setup ----
# !pip -q install ultralytics
# from google.colab import drive; drive.mount('/content/drive')
# !mkdir -p /content/p2 && cd /content/p2 && unzip -q /content/drive/MyDrive/phase2/phase2_data.zip -d data && cp /content/drive/MyDrive/phase2/rod_best.pt .
#
# ---- Cell 2: baseline score of the CURRENT model on the same validation pictures (old 25 classes only) ----
# from ultralytics import YOLO
# import yaml, os
# d = '/content/p2/data'
# y25 = {'path': d, 'train': 'images/train', 'val': 'images/val', 'names': dict(enumerate(yaml.safe_load(open(d+'/data.yaml'))['names'].values() if False else list(yaml.safe_load(open(d+'/data.yaml'))['names'].values())[:25]))}
# # YOLO finds labels by swapping 'images' for 'labels'; for the baseline we need the 25-class label copies, so link them in:
# !rm -rf /content/p2/base && mkdir -p /content/p2/base/images /content/p2/base/labels && ln -s /content/p2/data/images/val /content/p2/base/images/val && ln -s /content/p2/data/labels25/val /content/p2/base/labels/val
# yaml.safe_dump({'path': '/content/p2/base', 'train': 'images/val', 'val': 'images/val', 'names': y25['names']}, open('/content/p2/base25.yaml', 'w'))
# base = YOLO('/content/p2/rod_best.pt').val(data='/content/p2/base25.yaml', imgsz=416, plots=False)
# print('BASELINE mAP50 per class:', dict(zip(base.names.values(), base.box.ap50.round(3))))
#
# ---- Cell 3: keep what the old model knows (pseudo-label the old 25 classes) ----
# # Most of the new pictures have no boxes for trees, manholes, poles... The old model fills those in, so training does not erase them.
# import glob
# old = YOLO('/content/p2/rod_best.pt')
# def iou(a, b):
#     ax1, ay1, ax2, ay2 = a[0]-a[2]/2, a[1]-a[3]/2, a[0]+a[2]/2, a[1]+a[3]/2
#     bx1, by1, bx2, by2 = b[0]-b[2]/2, b[1]-b[3]/2, b[0]+b[2]/2, b[1]+b[3]/2
#     iw, ih = max(0, min(ax2, bx2)-max(ax1, bx1)), max(0, min(ay2, by2)-max(ay1, by1)); i = iw*ih
#     return i / (a[2]*a[3] + b[2]*b[3] - i + 1e-9)
# added = 0
# for split in ('train',):
#     for img in glob.glob(f'{d}/images/{split}/*'):
#         lbl = img.replace('/images/', '/labels/').rsplit('.', 1)[0] + '.txt'
#         have = [tuple(map(float, l.split())) for l in open(lbl)] if os.path.exists(lbl) else []
#         r = old.predict(img, imgsz=416, conf=0.55, verbose=False)[0]
#         new = []
#         for c, xywhn, cf in zip(r.boxes.cls.tolist(), r.boxes.xywhn.tolist(), r.boxes.conf.tolist()):
#             if any(iou(xywhn, h[1:]) > 0.4 for h in have): continue   # something is already labelled there (maybe by a human)
#             new.append(f'{int(c)} ' + ' '.join(f'{v:.6f}' for v in xywhn) + '\n'); added += 1
#         if new: open(lbl, 'a').writelines(new)
# print('pseudo-labels added:', added)
#
# ---- Cell 4: stage 1, new head only (backbone frozen) then stage 2, everything gently ----
# m = YOLO('/content/p2/rod_best.pt')
# m.train(data=d+'/data.yaml', imgsz=416, epochs=15, batch=32, freeze=10, lr0=0.002, project='/content/p2/runs', name='s1', patience=0)
# m = YOLO('/content/p2/runs/s1/weights/best.pt')
# m.train(data=d+'/data.yaml', imgsz=416, epochs=40, batch=32, lr0=0.0005, project='/content/p2/runs', name='s2', patience=10)
#
# ---- Cell 5: compare to the baseline, class by class ----
# new = YOLO('/content/p2/runs/s2/weights/best.pt').val(data=d+'/data.yaml', imgsz=416, plots=False)
# for i, n in new.names.items():
#     b = base.box.ap50[list(base.names.keys()).index(i)].round(3) if i < 25 else None
#     print(f'{n:22s} old={b}  new={new.box.ap50[list(new.names.keys()).index(i)].round(3)}')
# # Rule: swap the model in only if no old class drops by more than ~0.03 and the new classes score usefully.
# # Remember the picture sets are different shapes from your walks, so the real test is uk_own (Phase 2b) and the phone.
#
# ---- Cell 6: export for the app, and download ----
# YOLO('/content/p2/runs/s2/weights/best.pt').export(format='onnx', imgsz=416, opset=12, simplify=True)
# !cp /content/p2/runs/s2/weights/best.onnx /content/drive/MyDrive/phase2/rod2_416.onnx
# # Download rod2_416.onnx from Drive and send it to me. I add the five new class names to docs/js/config.js and wire it in.
