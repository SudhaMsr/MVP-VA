#!/usr/bin/env python3
"""Replay a recorded test video through both models offline and compare.

Usage: python3 tools/analyze_session.py VIDEO [LOG.json] [--step 3] [--out out_dir]
Writes: summary.txt (counts per class per model), annotated.mp4 (old model = green, ROD model = red).
If LOG.json (from the app's "Save recording" button) is given, also reports what the phone itself saw.
Needs: opencv-python, numpy, onnxruntime.
"""
import argparse, collections, json, os, sys
import cv2, numpy as np, onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', 'docs', 'models')
WOTR = ['tree','red_light','green_light','crosswalk','blind_road','sign','person','bicycle','bus','truck','car','motorcycle','reflective_cone','ashcan','warning_column','roadblock','pole','dog','tricycle','fire_hydrant']
ROD = ['Bike','Building','Car','Person','Stairs','Traffic sign','Electrical Pole','Road','Motorcycle','Dustbin','Dog','Manhole','Tree','Guard rail','Pedestrian crosswalk','Truck','Bus','Bench','Traffic Cone','Fire hydrant','Teraffic Barrel','Plant Pot','Electrical Box','Chair','Bicycle Rack']
ALIAS = {'bike':'bicycle','electrical_pole':'pole','dustbin':'ashcan','traffic_cone':'reflective_cone','teraffic_barrel':'roadblock','pedestrian_crosswalk':'crosswalk','traffic_sign':'sign'}
SLOW_ONLY = {'stairs','manhole','bench','chair','guard_rail','electrical_box','plant_pot','bicycle_rack'}

def canon(n):
    k = n.lower().replace(' ', '_'); return ALIAS.get(k, k)

class Model:
    def __init__(self, fname, size, names, conf):
        self.s = ort.InferenceSession(os.path.join(MODELS, fname), providers=['CPUExecutionProvider'])
        self.size, self.names, self.conf = size, names, conf
    def __call__(self, im):
        size = self.size; h, w = im.shape[:2]; r = min(size / w, size / h)
        nw, nh = int(round(w * r)), int(round(h * r)); dx, dy = (size - nw) // 2, (size - nh) // 2
        pad = np.full((size, size, 3), 114, np.uint8); pad[dy:dy+nh, dx:dx+nw] = cv2.resize(im, (nw, nh))
        x = pad[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255
        o = self.s.run(None, {'images': x})[0][0].T; sc = o[:, 4:]; cid = sc.argmax(1); cf = sc.max(1); k = cf > self.conf
        b, c, p = o[k, :4], cid[k], cf[k]
        xy = np.c_[(b[:,0]-b[:,2]/2-dx)/r, (b[:,1]-b[:,3]/2-dy)/r, b[:,2]/r, b[:,3]/r]; out = []
        for cl in set(c.tolist()):
            m = np.where(c == cl)[0]; idx = cv2.dnn.NMSBoxes(xy[m].tolist(), p[m].tolist(), self.conf, 0.5)
            for i in (np.array(idx).flatten() if len(idx) else []):
                j = m[i]; x0, y0, bw, bh = xy[j]; out.append((canon(self.names[c[j]]), float(p[j]), int(x0), int(y0), int(x0+bw), int(y0+bh)))
        return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('video'); ap.add_argument('log', nargs='?')
    ap.add_argument('--step', type=int, default=3, help='analyse every Nth frame'); ap.add_argument('--out', default='analysis')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    old = Model('best416.onnx', 416, WOTR, 0.45); rod = Model('rod416.onnx', 416, ROD, 0.40)
    cap = cv2.VideoCapture(a.video); fps = cap.get(cv2.CAP_PROP_FPS) or 30
    W, H = int(cap.get(3)), int(cap.get(4)); vw = cv2.VideoWriter(os.path.join(a.out, 'annotated.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), fps / a.step, (W, H))
    c_old, c_rod, n, i = collections.Counter(), collections.Counter(), 0, 0
    while True:
        ok, im = cap.read()
        if not ok: break
        i += 1
        if (i - 1) % a.step: continue
        n += 1; vis = im.copy()
        for name, p, x0, y0, x1, y1 in old(im):
            c_old[name] += 1; cv2.rectangle(vis, (x0, y0), (x1, y1), (0, 255, 0), 3); cv2.putText(vis, f'{name} {p:.2f}', (x0, max(24, y0+24)), 0, 0.8, (0, 255, 0), 2)
        for name, p, x0, y0, x1, y1 in rod(im):
            if name not in SLOW_ONLY: continue
            c_rod[name] += 1; cv2.rectangle(vis, (x0, y0), (x1, y1), (0, 0, 255), 3); cv2.putText(vis, f'{name} {p:.2f}', (x0, max(24, y0+24)), 0, 0.8, (0, 0, 255), 2)
        vw.write(vis)
    vw.release()
    lines = [f'Analysed {n} frames of {a.video}', '', 'Fast lane (old model, green) detections: ' + str(dict(c_old.most_common())),
             'Slow lane (ROD model, red; stairs/manholes/benches/chairs/guard rails only): ' + str(dict(c_rod.most_common()))]
    if a.log:
        L = json.load(open(a.log)); seen = collections.Counter(d[0] for f in L['frames'] for d in f['d'])
        ms = sorted(f['ms'] for f in L['frames']) or [0]
        lines += ['', f"Phone itself ({L.get('model')}, {L.get('size')}px): {len(L['frames'])} frames, median {ms[len(ms)//2]} ms, 95% under {ms[int(len(ms)*0.95)-1 if len(ms)>1 else 0]} ms",
                  'Phone detections (tracked objects per frame, summed): ' + str(dict(seen.most_common())),
                  'Alerts spoken: ' + str(len([e for e in L['events'] if e.get('type') == 'alert']))]
    open(os.path.join(a.out, 'summary.txt'), 'w').write('\n'.join(lines) + '\n'); print('\n'.join(lines))

if __name__ == '__main__':
    main()
