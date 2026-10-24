#!/usr/bin/env python3
"""Pull every Nth frame from walk videos into a folder, ready to label (Roboflow, CVAT or Label Studio).
Usage: python3 tools/extract_frames.py out_dir VIDEO [VIDEO...] [--every 15]"""
import sys, os, cv2
a = sys.argv[1:]; every = 15
if '--every' in a: i = a.index('--every'); every = int(a[i+1]); del a[i:i+2]
out, vids = a[0], a[1:]; os.makedirs(out, exist_ok=True); n = 0
for v in vids:
    cap = cv2.VideoCapture(v); k = 0; base = os.path.splitext(os.path.basename(v))[0]
    while True:
        ok, f = cap.read()
        if not ok: break
        if k % every == 0: cv2.imwrite(f'{out}/{base}_{k:05d}.jpg', f); n += 1
        k += 1
print('wrote', n, 'frames to', out)
