# Mapillary Vistas v2.0 -> a compact YOLO set in a Kaggle notebook (Internet on). CC BY-NC-SA 4.0 + Mapillary Research Use
# Licence: non-commercial, keep the data CONFIDENTIAL (private Kaggle dataset only), credit Mapillary.
# The download link is personal and signed (expires): set it in the notebook, never commit it.
#   VISTAS_URL = '<signed link for mapillary-vistas-dataset_public_v2.0.zip>'
#   import urllib.request as u; exec(u.urlopen('https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/vistas_kaggle.py').read())
# Keeps: every training/validation image resized to 640 px on the long side, and YOLO boxes (from the v2.0 polygons) for the
# classes in WANT. Skips the large instance/panoptic PNGs. Reads the zip with range requests; resumes on re-run.
# Set LIMIT_S = 60 for a speed test, LIST_ONLY = True to print what is inside first.
import os, io, json, time, zlib, struct, threading, subprocess, sys, collections
from concurrent.futures import ThreadPoolExecutor
try:
    import remotezip  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'remotezip'], check=True)
import requests
from remotezip import RemoteZip
from PIL import Image

URL = globals()['VISTAS_URL']
OUT = '/kaggle/working/vistas640'
SIDE, QUALITY, THREADS, GAP, BLOCK = 640, 88, 12, 1 << 20, 48 << 20
LIMIT_S = globals().get('LIMIT_S', 11.3 * 3600)
# Vision Assist names -> Vistas v2.0 readable names (matched case-insensitively against config_v2.0.json)
WANT = [('kerb', ['Curb']), ('dropped_kerb', ['Curb Cut']), ('pothole', ['Pothole']), ('manhole', ['Manhole']),
        ('bin', ['Trash Can']), ('bench', ['Bench']), ('street_light', ['Street Light']), ('bike_rack', ['Bike Rack']),
        ('ped_signal', ['Traffic Light - Pedestrians', 'Traffic Light - Pedestrians (Front)', 'Traffic Light - Pedestrians (Side)'])]

t0 = time.time()
infos = [i for i in RemoteZip(URL, timeout=300).infolist() if not i.filename.endswith('/')]
print(f'{len(infos)} files, {sum(i.file_size for i in infos) / 1e9:.1f} GB, listed in {time.time() - t0:.0f}s', flush=True)
if globals().get('LIST_ONLY'):
    c = collections.Counter('/'.join(i.filename.split('/')[:-1]) for i in infos)
    s = collections.Counter()
    for i in infos: s['/'.join(i.filename.split('/')[:-1])] += i.file_size
    for k, v in sorted(c.items()): print(f'{v:7d} {s[k] / 1e9:6.2f} GB  {k}')
    raise SystemExit

def split_of(n):
    n = n.lower()
    return 'train' if 'training/' in n else 'val' if 'validation/' in n else None

cfg = [i for i in infos if i.filename.endswith('config_v2.0.json')]
want = [i for i in infos if split_of(i.filename) and (
    (('/images/' in i.filename) and i.filename.lower().endswith('.jpg')) or ('/v2.0/polygons/' in i.filename and i.filename.endswith('.json')))]
print(f'keeping {len(want)} files ({sum(i.compress_size for i in want) / 1e9:.1f} GB to read)', flush=True)

sess = threading.local()
def get_range(a, b):
    for k in range(6):
        try:
            if not hasattr(sess, 's'): sess.s = requests.Session()
            r = sess.s.get(URL, headers={'Range': f'bytes={a}-{b}'}, timeout=(30, 600))
            if r.status_code == 206 and len(r.content) == b - a + 1: return r.content
        except Exception:
            pass
        time.sleep(3 * (k + 1)); sess.__dict__.pop('s', None)
    return None

def read_member(i):
    head = get_range(i.header_offset, i.header_offset + 29)
    n, m = struct.unpack('<HH', head[26:30])
    raw = get_range(i.header_offset + 30 + n + m, i.header_offset + 30 + n + m + i.compress_size - 1)
    return zlib.decompressobj(-15).decompress(raw) if i.compress_type == 8 else raw

# class map from the dataset's own config
labels = json.loads(read_member(cfg[0]))['labels'] if cfg else []
readable = {str(l.get('readable', '')).lower(): l['name'] for l in labels}
cls_of = {}
for k, (va, names) in enumerate(WANT):
    for nm in names:
        if nm.lower() in readable: cls_of[readable[nm.lower()]] = k
print('class map:', {v: WANT[k][0] for v, k in cls_of.items()}, flush=True)
missing = [va for k, (va, _) in enumerate(WANT) if k not in cls_of.values()]
if missing: print('NOT FOUND in config (check names):', missing, flush=True)

def stem(n): return os.path.splitext(os.path.basename(n))[0]
def img_path(i): return os.path.join(OUT, split_of(i.filename), 'images', stem(i.filename) + '.jpg')
def lab_path(i): return os.path.join(OUT, split_of(i.filename), 'labels', stem(i.filename) + '.txt')
def target(i): return img_path(i) if '/images/' in i.filename else lab_path(i)

want.sort(key=lambda i: i.header_offset)
todo = [i for i in want if not os.path.exists(target(i))]
blocks, cur = [], []
for i in todo:
    end = i.header_offset + 30 + len(i.filename.encode()) + 256 + i.compress_size
    if cur and (i.header_offset - cur_end > GAP or end - cur[0].header_offset > BLOCK):
        blocks.append((cur[0].header_offset, cur_end - 1, cur)); cur = []
    if not cur: pass
    cur.append(i); cur_end = end
if cur: blocks.append((cur[0].header_offset, cur_end - 1, cur))
print(f'{len(blocks)} blocks to fetch', flush=True)

lock = threading.Lock(); st = collections.Counter(); boxes = collections.Counter()
def do_block(blk):
    a, b, items = blk
    if time.time() - t0 > LIMIT_S: return
    data = get_range(a, b)
    if data is None:
        with lock: st['err'] += len(items)
        return
    for i in items:
        r = i.header_offset - a
        n, m = struct.unpack('<HH', data[r + 26:r + 30])
        raw = data[r + 30 + n + m: r + 30 + n + m + i.compress_size]
        body = zlib.decompressobj(-15).decompress(raw) if i.compress_type == 8 else raw
        p = target(i); os.makedirs(os.path.dirname(p), exist_ok=True)
        try:
            if p.endswith('.jpg'):
                im = Image.open(io.BytesIO(body)).convert('RGB'); im.thumbnail((SIDE, SIDE))
                buf = io.BytesIO(); im.save(buf, 'JPEG', quality=QUALITY); out = buf.getvalue()
            else:
                j = json.loads(body); W, H = j['width'], j['height']; rows = []
                for o in j.get('objects', []):
                    k = cls_of.get(o.get('label'))
                    if k is None or not o.get('polygon'): continue
                    xs = [pt[0] for pt in o['polygon']]; ys = [pt[1] for pt in o['polygon']]
                    x1, x2, y1, y2 = max(0, min(xs)), min(W, max(xs)), max(0, min(ys)), min(H, max(ys))
                    if x2 - x1 < 2 or y2 - y1 < 2: continue
                    rows.append(f'{k} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {(x2 - x1) / W:.6f} {(y2 - y1) / H:.6f}')
                    with lock: boxes[WANT[k][0]] += 1
                out = ('\n'.join(rows) + '\n' if rows else '').encode()
        except Exception:
            with lock: st['err'] += 1
            continue
        open(p + '.part', 'wb').write(out); os.replace(p + '.part', p)
        with lock: st['files'] += 1; st['kept'] += len(out)
    with lock:
        st['read'] += b - a + 1; el = time.time() - t0
        print(f"{st['files']} files  {st['read'] / 1e9:.1f} GB read  {st['kept'] / 1e9:.2f} GB kept  {st['read'] / 1e6 / el:.1f} MB/s  {el / 60:.1f} min  errors {st['err']}", flush=True)

with ThreadPoolExecutor(THREADS) as ex: list(ex.map(do_block, blocks))
open(os.path.join(OUT, 'data.yaml'), 'w').write(
    f"path: {OUT}\ntrain: train/images\nval: val/images\nnames:\n" + ''.join(f'  {k}: {va}\n' for k, (va, _) in enumerate(WANT)))
open(os.path.join(OUT, 'SOURCE.txt'), 'w').write(
    'Mapillary Vistas v2.0, CC BY-NC-SA 4.0 + Mapillary Research Use Licence. Non-commercial. CONFIDENTIAL: keep private.\n'
    'Images resized to 640 px (long side). YOLO boxes from v2.0 polygons for: ' + ', '.join(va for va, _ in WANT) + '.\n'
    'To be merged with the app\'s existing training data (fine-tune from current weights), not used alone.\n')
left = sum(1 for i in want if not os.path.exists(target(i)))
print(f'finished in {(time.time() - t0) / 60:.1f} min: {dict(st)}; boxes per class {dict(boxes)}; files still missing {left}')
