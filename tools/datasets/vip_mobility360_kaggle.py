# VIP-Mobility360 (Liverpool John Moores University, UK; CC BY 4.0; DOI 10.24377/LJMU.d.00000226) into a Kaggle notebook.
# Run in a Kaggle notebook with Internet on (one line in a cell):
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/vip_mobility360_kaggle.py").read())
# Set LIMIT_S = 60 first for a speed test. The zip is 110 GB, a Kaggle notebook keeps 19.5 GB, so every image is resized to
# 640 px on the long side (the size our YOLO models train at); YOLO labels are kept unchanged (normalised boxes); XML files
# are kept but their boxes are in the ORIGINAL pixel size. The zip's file list is read once; the files are then fetched in
# large consecutive blocks with parallel HTTP range requests (no 110 GB download to disk). Re-running resumes.
import os, io, time, zlib, struct, threading, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
try:
    import remotezip  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'remotezip'], check=True)
import requests
from remotezip import RemoteZip
from PIL import Image

URL = 'https://opendata.ljmu.ac.uk/id/eprint/226/4/VIP-Mobility360.zip'
OUT = '/kaggle/working/vip640'
SIDE, QUALITY = 640, 88
BLOCK = 48 * 1024 * 1024
THREADS = 12
LIMIT_S = globals().get('LIMIT_S', 11.3 * 3600)
IMG = ('.jpg', '.jpeg', '.png')

t0 = time.time()
infos = [i for i in RemoteZip(URL, timeout=300).infolist() if not i.filename.endswith('/')]
infos.sort(key=lambda i: i.header_offset)
print(f'{len(infos)} files listed in {time.time() - t0:.0f}s', flush=True)

def out_path(name):
    p = os.path.join(OUT, name)
    return os.path.splitext(p)[0] + '.jpg' if name.lower().endswith(IMG) else p

# consecutive blocks of about BLOCK bytes; a block is skipped when all its files are already here
blocks, cur = [], []
for k, i in enumerate(infos):
    cur.append(i)
    end = infos[k + 1].header_offset if k + 1 < len(infos) else i.header_offset + 30 + len(i.filename.encode()) + 1024 + i.compress_size
    if end - cur[0].header_offset >= BLOCK or k + 1 == len(infos):
        blocks.append((cur[0].header_offset, end - 1, cur)); cur = []
todo = [b for b in blocks if not all(os.path.exists(out_path(i.filename)) for i in b[2])]
print(f'{len(blocks)} blocks, {len(blocks) - len(todo)} already done, {len(todo)} to fetch', flush=True)

lock = threading.Lock(); st = {'files': 0, 'read': 0, 'kept': 0, 'err': 0}
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

def do_block(blk):
    a, b, items = blk
    if time.time() - t0 > LIMIT_S: return
    data = get_range(a, b)
    if data is None:
        with lock: st['err'] += len(items)
        return
    for i in items:
        p = out_path(i.filename)
        if os.path.exists(p): continue
        r = i.header_offset - a
        n, m = struct.unpack('<HH', data[r + 26:r + 30])
        raw = data[r + 30 + n + m: r + 30 + n + m + i.compress_size]
        body = zlib.decompressobj(-15).decompress(raw) if i.compress_type == 8 else raw
        if i.filename.lower().endswith(IMG):
            try:
                im = Image.open(io.BytesIO(body)).convert('RGB'); im.thumbnail((SIDE, SIDE))
                buf = io.BytesIO(); im.save(buf, 'JPEG', quality=QUALITY); body = buf.getvalue()
            except Exception:
                with lock: st['err'] += 1
                continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p + '.part', 'wb').write(body); os.replace(p + '.part', p)
        with lock: st['files'] += 1; st['kept'] += len(body)
    with lock:
        st['read'] += b - a + 1
        el = time.time() - t0
        print(f"{st['files']} files  {st['read'] / 1e9:.1f} GB read  {st['kept'] / 1e9:.2f} GB kept  "
              f"{st['read'] / 1e6 / el:.1f} MB/s  {el / 60:.1f} min  errors {st['err']}", flush=True)

with ThreadPoolExecutor(THREADS) as ex: list(ex.map(do_block, todo))
el = time.time() - t0
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'SOURCE.txt'), 'w').write(
    'VIP-Mobility360, Liverpool John Moores University (UK), CC BY 4.0, DOI 10.24377/LJMU.d.00000226.\n'
    'Images resized to 640 px on the long side (JPEG q88). YOLO labels unchanged (normalised). XML boxes are in ORIGINAL pixels.\n')
left = sum(1 for i in infos if not os.path.exists(out_path(i.filename)))
print(f"finished in {el / 60:.1f} min: {st['files']} new files, {st['read'] / 1e9:.1f} GB read at {st['read'] / 1e6 / max(el, 1):.1f} MB/s, "
      f"{st['kept'] / 1e9:.2f} GB kept, errors {st['err']}, files still missing {left}")
