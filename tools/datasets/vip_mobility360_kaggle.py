# Run in a Kaggle notebook with Internet on:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/tools/vip-mobility360/tools/datasets/vip_mobility360_kaggle.py").read())
# Reads the 110 GB zip from LJMU with HTTP range requests (no full download), so it fits in /kaggle/working (19.5 GB).
# VIP-Mobility360 -> /kaggle/working/vip640: every image resized to 640 px on the long side (YOLO input size),
# every YOLO label and XML file as is. Resumes if run again. LIMIT_S stops early (for a speed test).
import os, io, time, threading, pickle, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
try:
    import remotezip
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'remotezip'], check=True)
from remotezip import RemoteZip
from PIL import Image
URL = 'https://opendata.ljmu.ac.uk/id/eprint/226/4/VIP-Mobility360.zip'
OUT = '/kaggle/working/vip640'; SIDE = 640; LIMIT_S = globals().get('LIMIT_S', 11.3 * 3600); THREADS = 32
IDX = '/kaggle/working/vip_index.pkl'
if not os.path.exists(IDX):
    pickle.dump([(i.filename, i.file_size) for i in RemoteZip(URL, timeout=300).infolist()], open(IDX, 'wb'))
idx = [(n, s) for n, s in pickle.load(open(IDX, 'rb')) if not n.endswith('/')]
done = set()
for r, _, fs in os.walk(OUT):
    for f in fs: done.add(os.path.relpath(os.path.join(r, f), OUT))
todo = [(n, s) for n, s in idx if n not in done]
print(f'{len(idx)} files, {len(done)} already here, {len(todo)} to fetch', flush=True)
local = threading.local(); lock = threading.Lock(); st = {'n': 0, 'in': 0, 'out': 0, 'err': 0}; t0 = time.time()
def one(item):
    n, s = item
    if time.time() - t0 > LIMIT_S: return
    for k in range(5):
        try:
            if not hasattr(local, 'z'): local.z = RemoteZip(URL, timeout=300)
            data = local.z.read(n); break
        except Exception:
            time.sleep(2 * (k + 1)); local.__dict__.pop('z', None)
    else:
        with lock: st['err'] += 1
        return
    p = os.path.join(OUT, n); os.makedirs(os.path.dirname(p), exist_ok=True)
    if n.lower().endswith(('.jpg', '.jpeg', '.png')):
        im = Image.open(io.BytesIO(data)).convert('RGB'); im.thumbnail((SIDE, SIDE))
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88); data = buf.getvalue()
        p = os.path.splitext(p)[0] + '.jpg'
    tmp = p + '.part'; open(tmp, 'wb').write(data); os.replace(tmp, p)
    with lock:
        st['n'] += 1; st['in'] += s; st['out'] += len(data)
        if st['n'] % 1000 == 0:
            el = time.time() - t0
            print(f"{st['n']}/{len(todo)} files  {st['in']/1e9:.1f} GB read  {st['out']/1e9:.2f} GB kept  {st['in']/1e6/el:.1f} MB/s  {el/60:.0f} min  errors {st['err']}", flush=True)
with ThreadPoolExecutor(THREADS) as ex: list(ex.map(one, todo))
el = time.time() - t0
print(f"stopped after {el/60:.1f} min: {st['n']} files, {st['in']/1e9:.2f} GB read at {st['in']/1e6/max(el,1):.1f} MB/s, {st['out']/1e9:.2f} GB kept, errors {st['err']}")
open(os.path.join(OUT, 'SOURCE.txt'), 'w').write('VIP-Mobility360, Liverpool John Moores University (UK), CC BY 4.0, DOI 10.24377/LJMU.d.00000226.\n'
  'Images resized to 640 px on the long side (JPEG q88); YOLO labels unchanged (normalised); XML boxes are in ORIGINAL pixel size.\n')
