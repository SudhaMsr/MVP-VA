# Step 3 of the final MVP training plan: a Bristol test set from Mapillary street-level photos (CC BY-SA 4.0).
# Run in a Kaggle notebook (CPU, Internet on). The Mapillary client token is a Kaggle Secret named MAPILLARY_TOKEN, added
# by the owner by hand; it is never written in the notebook or committed. One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/mapillary_bristol_testset.py").read())
# What it keeps: flat (not 360) photos from sequences that move at walking pace (median under 2.5 m/s between photos),
# so the view is closer to a phone held by a walker than to a car dashcam; at most PER_SEQ photos per sequence, spread
# over a grid of small boxes across central Bristol so one street does not dominate. Mapillary blurs faces and number
# plates itself. Every photo's id, creator, time, place and licence go in manifest.csv (CC BY-SA needs credit).
# These photos are for TESTING ONLY: never train on them, so the scores stay honest. Labels are added later by hand
# (pre-filled by the current model, then corrected), not by this script.
import os, io, csv, time, math, json, random, collections, statistics
import requests
from PIL import Image

OUT = globals().get('OUT_DIR', '/kaggle/working/bristol_mapillary_test')
TARGET = globals().get('TARGET', 1000)
PER_SEQ = globals().get('PER_SEQ', 4)
MAX_SPEED = 2.5            # metres per second; brisk walking is about 1.5 to 2
SIDE = 640
# central Bristol (lon_min, lat_min, lon_max, lat_max), cut into CELL-degree boxes (the API wants small boxes)
AREA = globals().get('AREA', (-2.640, 51.430, -2.540, 51.475))
CELL = 0.01
FIELDS = 'id,captured_at,geometry,sequence,camera_type,is_pano,thumb_1024_url,creator,compass_angle'
random.seed(13)

from kaggle_secrets import UserSecretsClient
TOKEN = UserSecretsClient().get_secret('MAPILLARY_TOKEN')
S = requests.Session()


def get(url, params, tries=4):
    for k in range(tries):
        try:
            r = S.get(url, params=params, timeout=60)
            if r.status_code == 200: return r.json()
            if r.status_code in (401, 403): raise SystemExit(f'Mapillary refused the token ({r.status_code}). Check the MAPILLARY_TOKEN secret.')
        except requests.RequestException:
            pass
        time.sleep(2 * (k + 1))
    return None


def metres(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)); y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


cells = []
lon = AREA[0]
while lon < AREA[2]:
    lat = AREA[1]
    while lat < AREA[3]:
        cells.append((round(lon, 4), round(lat, 4), round(min(lon + CELL, AREA[2]), 4), round(min(lat + CELL, AREA[3]), 4)))
        lat += CELL
    lon += CELL
print(f'{len(cells)} boxes to search', flush=True)

by_seq = collections.defaultdict(list)
for i, c in enumerate(cells):
    j = get('https://graph.mapillary.com/images', {'access_token': TOKEN, 'fields': FIELDS, 'bbox': ','.join(map(str, c)), 'limit': 2000})
    for im in (j or {}).get('data', []):
        if im.get('is_pano') or im.get('camera_type') in ('spherical', 'equirectangular') or not im.get('thumb_1024_url'): continue
        im['cell'] = i
        by_seq[im.get('sequence')].append(im)
    print(f'box {i + 1}/{len(cells)}: {sum(len(v) for v in by_seq.values())} flat photos so far', flush=True)

walk = {}
for seq, ims in by_seq.items():
    ims.sort(key=lambda m: m['captured_at'])
    sp = []
    for a, b in zip(ims, ims[1:]):
        dt = (b['captured_at'] - a['captured_at']) / 1000
        if 0 < dt < 60: sp.append(metres(a['geometry']['coordinates'], b['geometry']['coordinates']) / dt)
    if len(sp) >= 3 and statistics.median(sp) < MAX_SPEED: walk[seq] = ims
print(f'{len(by_seq)} sequences, {len(walk)} at walking pace', flush=True)

# spread: round-robin over boxes, a few evenly spaced photos per sequence
per_cell = collections.defaultdict(list)
for seq, ims in walk.items():
    step = max(1, len(ims) // PER_SEQ)
    per_cell[ims[0]['cell']].append(ims[::step][:PER_SEQ])
for v in per_cell.values(): random.shuffle(v)
chosen, queues = [], {c: list(v) for c, v in per_cell.items()}
while len(chosen) < TARGET and any(queues.values()):
    for c in list(queues):
        if queues[c] and len(chosen) < TARGET: chosen.extend(queues[c].pop(0))
chosen = chosen[:TARGET]

os.makedirs(f'{OUT}/images', exist_ok=True)
rows, failed = [], 0
for k, im in enumerate(chosen):
    p = f"{OUT}/images/mly_{im['id']}.jpg"
    if not os.path.exists(p):
        try:
            r = S.get(im['thumb_1024_url'], timeout=60); r.raise_for_status()
            pic = Image.open(io.BytesIO(r.content)).convert('RGB'); pic.thumbnail((SIDE, SIDE)); pic.save(p, 'JPEG', quality=90)
        except Exception:
            failed += 1; continue
    lon_, lat_ = im['geometry']['coordinates']
    rows.append({'file': os.path.basename(p), 'mapillary_id': im['id'], 'sequence': im.get('sequence'),
                 'captured_at_utc': time.strftime('%Y-%m-%d %H:%M', time.gmtime(im['captured_at'] / 1000)),
                 'lon': lon_, 'lat': lat_, 'creator': (im.get('creator') or {}).get('username', ''),
                 'licence': 'CC BY-SA 4.0', 'url': f"https://www.mapillary.com/app/?pKey={im['id']}"})
    if (k + 1) % 100 == 0: print(f'{k + 1}/{len(chosen)} photos saved', flush=True)
with open(f'{OUT}/manifest.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ['file']); w.writeheader(); w.writerows(rows)
open(f'{OUT}/SOURCE.txt', 'w').write(
    'Bristol street-level photos from Mapillary (CC BY-SA 4.0; credit each creator, see manifest.csv). Faces and number\n'
    'plates are blurred by Mapillary. Flat photos from sequences at walking pace (median under 2.5 m/s). TEST ONLY: never\n'
    'train on these. Labels are added by hand later (pre-filled by the current model, then corrected).\n')
print(f'done: {len(rows)} photos from {len({r["sequence"] for r in rows})} sequences, {failed} failed downloads')
