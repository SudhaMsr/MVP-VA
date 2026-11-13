# Project Sidewalk "sidewalk-tagger-ai" (University of Washington Makeability Lab; Google Street View crops of sidewalk
# features with 33 accessibility tags; Hugging Face projectsidewalk/sidewalk-tagger-ai-validated, about 71 GB in 4 zips)
# into a Kaggle notebook (Internet on). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/sidewalk_tagger_kaggle.py").read())
# Set LIST_ONLY = True first to see what each zip holds, LIMIT_S = 60 for a speed test, ZIPS = ['CurbRamp'] for a subset.
# Each zip's file list is read once, then files are fetched in large consecutive blocks with parallel HTTP range requests
# (no 71 GB download to disk). Images are re-encoded as JPEG, at most 640 px; CSV and other small files are kept as they are.
# Labels are tags per crop plus the label point (x, y), not boxes: use them for a tag classifier or to check auto-labels.
# The dataset licence is not stated (the code repository is Apache-2.0): research use only until the authors confirm.
import os, io, time, zlib, struct, threading, subprocess, sys, collections
from concurrent.futures import ThreadPoolExecutor
try:
    import remotezip  # noqa: F401
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'remotezip'], check=True)
import requests
from remotezip import RemoteZip
from PIL import Image

BASE = 'https://huggingface.co/datasets/projectsidewalk/sidewalk-tagger-ai-validated/resolve/main/Validated/'
ZIPS = globals().get('ZIPS', ['CurbRamp', 'SurfaceProblem', 'Obstacle', 'Crosswalk'])
OUT = '/kaggle/working/sidewalk640'
SIDE, QUALITY, THREADS, BLOCK = 640, 88, 12, 48 << 20
LIMIT_S = globals().get('LIMIT_S', 11.3 * 3600)
IMG = ('.jpg', '.jpeg', '.png', '.webp')
t0 = time.time()


def out_path(zname, name):
    p = os.path.join(OUT, zname, name)
    return os.path.splitext(p)[0] + '.jpg' if name.lower().endswith(IMG) else p


def run_zip(zname):
    url = BASE + zname + '.zip'
    sess = threading.local()
    infos = [i for i in RemoteZip(url, timeout=300, support_suffix_range=False).infolist() if not i.filename.endswith('/')]
    infos.sort(key=lambda i: i.header_offset)
    print(f'{zname}: {len(infos)} files, {sum(i.compress_size for i in infos) / 1e9:.1f} GB', flush=True)
    if globals().get('LIST_ONLY'):
        c, s = collections.Counter(), collections.Counter()
        for i in infos:
            k = '/'.join(i.filename.split('/')[:-1]) + '  *' + os.path.splitext(i.filename)[1].lower()
            c[k] += 1; s[k] += i.compress_size
        for k, v in sorted(c.items()): print(f'  {v:7d} {s[k] / 1e9:6.2f} GB  {k}')
        print('  first files:', [i.filename for i in infos[:5]], flush=True)
        return
    blocks, cur = [], []
    for k, i in enumerate(infos):
        cur.append(i)
        end = infos[k + 1].header_offset if k + 1 < len(infos) else i.header_offset + 30 + len(i.filename.encode()) + 1024 + i.compress_size
        if end - cur[0].header_offset >= BLOCK or k + 1 == len(infos):
            blocks.append((cur[0].header_offset, end - 1, cur)); cur = []
    todo = [b for b in blocks if not all(os.path.exists(out_path(zname, i.filename)) for i in b[2])]
    print(f'{zname}: {len(blocks)} blocks, {len(todo)} to fetch', flush=True)
    lock = threading.Lock(); st = collections.Counter()

    def get_range(a, b):
        for k in range(6):
            try:
                if not hasattr(sess, 's'): sess.s = requests.Session()
                r = sess.s.get(url, headers={'Range': f'bytes={a}-{b}'}, timeout=(30, 600))
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
            p = out_path(zname, i.filename)
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
            st['read'] += b - a + 1; el = time.time() - t0
            print(f"{zname}: {st['files']} files  {st['read'] / 1e9:.1f} GB read  {st['kept'] / 1e9:.2f} GB kept  "
                  f"{st['read'] / 1e6 / el:.1f} MB/s  {el / 60:.1f} min  errors {st['err']}", flush=True)

    with ThreadPoolExecutor(THREADS) as ex: list(ex.map(do_block, todo))
    left = sum(1 for i in infos if not os.path.exists(out_path(zname, i.filename)))
    print(f"{zname} finished: {st['files']} new files, {st['kept'] / 1e9:.2f} GB kept, errors {st['err']}, files still missing {left}", flush=True)


for z in ZIPS:
    run_zip(z)
if not globals().get('LIST_ONLY'):
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'SOURCE.txt'), 'w').write(
        'Project Sidewalk sidewalk-tagger-ai, validated set (Makeability Lab, University of Washington), Google Street View crops.\n'
        'https://github.com/ProjectSidewalk/sidewalk-tagger-ai  https://huggingface.co/datasets/projectsidewalk/sidewalk-tagger-ai-validated\n'
        'Paper: Liu et al., ASSETS 2024. Dataset licence not stated: research use only until the authors confirm.\n'
        'Images re-encoded as JPEG (max 640 px). CSVs unchanged: tags per crop and the label point, not boxes.\n')
    print(f'all done in {(time.time() - t0) / 60:.1f} min')
