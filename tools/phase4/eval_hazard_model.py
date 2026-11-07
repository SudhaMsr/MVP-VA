#!/usr/bin/env python3
"""Score the hazard lane on a labelled YOLO-format dataset, e.g. VIP-Mobility360 (LJMU, CC BY 4.0: e-scooters, bollards,
wheelie bins, rubbish bags, advertising boards, roadwork signs, potholes, puddles), so we know which classes are good
enough to speak before any of them is allowed to.
    python3 tools/phase4/eval_hazard_model.py DATASET_DIR --map "E-Scooter=e_scooter,Bollard=bollard,Wheelie-bin=wheelie_bin,Trash-bag=rubbish_bag,Advert-board=a_board,Roadwork=road_barrier,Pothole=pothole"
DATASET_DIR holds images/ and labels/ (any depth); each label line: class cx cy w h (normalised), and the class name comes from
a classes.txt or data.yaml next to labels, or from the folder name when every image in a folder is one class.
Prints precision, recall and false alarms per 100 images for each class at the app's threshold, and writes
hazard_eval.json. A class is a candidate to speak only with precision >= 0.9 at recall >= 0.6 (then the walk gate still applies).
Needs: numpy, opencv-python, onnxruntime.
"""
import argparse, collections, json, os, pathlib, re
import cv2, numpy as np, onnxruntime as ort
ROOT = pathlib.Path(__file__).resolve().parents[2]
NAMES = [c['name'] for c in json.loads((ROOT / 'tools/phase4/hazard_vocab.json').read_text())['classes']]

def detect(sess, im, size, conf):
    h, w = im.shape[:2]; r = min(size / w, size / h); nw, nh = int(round(w * r)), int(round(h * r)); dx, dy = (size - nw) // 2, (size - nh) // 2
    pad = np.full((size, size, 3), 114, np.uint8); pad[dy:dy + nh, dx:dx + nw] = cv2.resize(im, (nw, nh))
    x = pad[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255
    o = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]          # [4 + nc (+32 mask coefficients), N]
    sc = o[4:4 + len(NAMES)].T; cid = sc.argmax(1); cf = sc.max(1); k = cf >= conf
    b = o[:4].T[k]; out = []
    xy = np.c_[(b[:, 0] - b[:, 2] / 2 - dx) / r, (b[:, 1] - b[:, 3] / 2 - dy) / r, b[:, 2] / r, b[:, 3] / r]
    for c in set(cid[k].tolist()):
        m = np.where(cid[k] == c)[0]; idx = cv2.dnn.NMSBoxes(xy[m].tolist(), cf[k][m].tolist(), conf, 0.5)
        for i in (np.array(idx).flatten() if len(idx) else []):
            x0, y0, bw, bh = xy[m[i]]; out.append((NAMES[c], x0, y0, x0 + bw, y0 + bh))
    return out

def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1])); i = ix * iy
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)

def class_names(label_path):
    for p in [label_path.parent, *label_path.parents]:
        if (p / 'classes.txt').exists(): return [l.strip() for l in (p / 'classes.txt').read_text().splitlines() if l.strip()]
        y = p / 'data.yaml'
        if y.exists():
            t = y.read_text(); m = re.search(r'names:\s*\[(.*?)\]', t, re.S)
            if m: return [s.strip().strip('\'"') for s in m.group(1).split(',')]
            return re.findall(r'^\s*\d+:\s*(.+)$', t, re.M)
        if p.name in ('labels',) and p.parent.name: return [p.parent.name]
    return [label_path.parent.parent.name]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dataset'); ap.add_argument('--map', required=True)
    ap.add_argument('--model', default=str(ROOT / 'docs/models/hazard320.onnx')); ap.add_argument('--size', type=int, default=320)
    ap.add_argument('--conf', type=float, default=0.35); ap.add_argument('--limit', type=int, default=3000); a = ap.parse_args()
    cmap = dict(kv.split('=') for kv in a.map.split(','))
    sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
    tp, fp, fn = collections.Counter(), collections.Counter(), collections.Counter(); n = 0
    imgs = sorted(p for p in pathlib.Path(a.dataset).rglob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png'))[:a.limit]
    for ip in imgs:
        lp = pathlib.Path(str(ip).replace(f'{os.sep}images{os.sep}', f'{os.sep}labels{os.sep}')).with_suffix('.txt')
        im = cv2.imread(str(ip))
        if im is None: continue
        h, w = im.shape[:2]; gt = []
        if lp.exists():
            names = class_names(lp)
            for line in lp.read_text().split('\n'):
                p = line.split()
                if len(p) < 5: continue
                src = names[int(p[0])] if int(p[0]) < len(names) else names[-1]
                if src not in cmap: continue
                cx, cy, bw, bh = (float(v) for v in p[1:5])
                gt.append([cmap[src], (cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h, False])
        n += 1
        for d in detect(sess, im, a.size, a.conf):
            best = max((g for g in gt if g[0] == d[0] and not g[5]), key=lambda g: iou(d[1:], g[1:5]), default=None)
            if best is not None and iou(d[1:], best[1:5]) >= 0.3: best[5] = True; tp[d[0]] += 1
            elif d[0] in cmap.values(): fp[d[0]] += 1
        for g in gt:
            if not g[5]: fn[g[0]] += 1
    res = {}
    for c in sorted(set(cmap.values())):
        p = tp[c] / (tp[c] + fp[c]) if tp[c] + fp[c] else None; r = tp[c] / (tp[c] + fn[c]) if tp[c] + fn[c] else None
        res[c] = {'precision': p, 'recall': r, 'false_per_100_images': round(100 * fp[c] / max(n, 1), 1), 'tp': tp[c], 'fp': fp[c], 'fn': fn[c],
                  'candidate_to_speak': bool(p and r and p >= 0.9 and r >= 0.6)}
        print(f"{c:14s} precision {p if p is None else round(p, 2)}  recall {r if r is None else round(r, 2)}  false/100 img {res[c]['false_per_100_images']}  {'CANDIDATE' if res[c]['candidate_to_speak'] else ''}")
    pathlib.Path('hazard_eval.json').write_text(json.dumps({'images': n, 'conf': a.conf, 'classes': res}, indent=2)); print('images:', n, '-> hazard_eval.json')

if __name__ == '__main__':
    main()
