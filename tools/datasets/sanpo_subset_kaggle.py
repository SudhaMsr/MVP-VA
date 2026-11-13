# A small walker's-eye test subset of Google's SANPO dataset (CC BY 4.0): real outdoor walks filmed from a chest-mounted
# camera, with human segmentation masks (30 classes incl. sidewalk, curb, poles, bike racks, trees, pedestrians).
# Run in a Kaggle notebook (CPU, Internet on). The bucket is public; no sign-up or key. One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/sanpo_subset_kaggle.py").read())
# For each SANPO-Real session that has segmentation masks for the chest camera's left lens, it takes up to PER_SESSION
# evenly spaced frames: the frame (re-encoded as JPEG, at most 640 px) and its mask PNG unchanged, plus labelmap.json and
# labeltype.json. Masks are kept raw so the conversion to boxes can be checked against the label map before use.
# TEST ONLY: never train on these frames, so the walker's-eye scores stay honest.
import os, io, csv, json, time, urllib.parse
import requests
from PIL import Image

BUCKET, ROOT = 'gresearch', 'sanpo_dataset/v0'
OUT = globals().get('OUT_DIR', '/kaggle/working/sanpo_test')
PER_SESSION = globals().get('PER_SESSION', 3)
MAX_SESSIONS = globals().get('MAX_SESSIONS', 700)
SIDE = 640
S = requests.Session()
API = f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o'
MEDIA = f'https://storage.googleapis.com/{BUCKET}/'


def list_objects(prefix, delimiter=None, max_items=None):
    names, prefixes, token = [], [], None
    while True:
        p = {'prefix': prefix, 'fields': 'items(name,size),prefixes,nextPageToken', 'maxResults': 1000}
        if delimiter: p['delimiter'] = delimiter
        if token: p['pageToken'] = token
        for k in range(4):
            try:
                r = S.get(API, params=p, timeout=60)
                if r.status_code == 200: break
            except requests.RequestException:
                pass
            time.sleep(2 * (k + 1))
        else:
            raise RuntimeError(f'listing failed for {prefix}')
        j = r.json()
        names += [i['name'] for i in j.get('items', [])]
        prefixes += j.get('prefixes', [])
        token = j.get('nextPageToken')
        if not token or (max_items and len(names) >= max_items): return names, prefixes


def fetch(name):
    for k in range(4):
        try:
            r = S.get(MEDIA + urllib.parse.quote(name), timeout=120)
            if r.status_code == 200: return r.content
        except requests.RequestException:
            pass
        time.sleep(2 * (k + 1))
    return None


os.makedirs(f'{OUT}/images', exist_ok=True); os.makedirs(f'{OUT}/masks', exist_ok=True)
for meta in ('labelmap.json', 'labeltype.json'):
    b = fetch(f'{ROOT}/{meta}')
    if b: open(f'{OUT}/{meta}', 'wb').write(b)

_, sessions = list_objects(f'{ROOT}/sanpo-real/', delimiter='/')
print(f'{len(sessions)} SANPO-Real sessions', flush=True)
rows, with_masks, layout_note = [], 0, None
for si, sess in enumerate(sessions[:MAX_SESSIONS]):
    left = f'{sess}camera_chest/left/'
    _, subdirs = list_objects(left, delimiter='/')
    sub = {d[len(left):].strip('/') for d in subdirs}
    if 'segmentation_masks' not in sub: continue
    frame_dir = next((d for d in ('video_frames', 'frames', 'images', 'rgb') if d in sub), None)
    if not frame_dir:
        layout_note = layout_note or f'no frame folder found in {left}: {sorted(sub)}'; continue
    masks, _ = list_objects(f'{left}segmentation_masks/')
    masks = sorted(m for m in masks if m.endswith('.png'))
    if not masks: continue
    with_masks += 1
    step = max(1, len(masks) // PER_SESSION)
    for m in masks[step // 2::step][:PER_SESSION]:
        stem = os.path.splitext(os.path.basename(m))[0]
        frames, _ = list_objects(f'{left}{frame_dir}/{stem}')
        if not frames: continue
        fb, mb = fetch(frames[0]), fetch(m)
        if not fb or not mb: continue
        sid = sess.rstrip('/').split('/')[-1]
        name = f'{sid}_{stem}'
        try:
            im = Image.open(io.BytesIO(fb)).convert('RGB'); w, h = im.size
            im.thumbnail((SIDE, SIDE)); im.save(f'{OUT}/images/{name}.jpg', 'JPEG', quality=90)
        except Exception:
            continue
        open(f'{OUT}/masks/{name}.png', 'wb').write(mb)
        rows.append({'file': f'{name}.jpg', 'mask': f'{name}.png', 'session': sid, 'frame': stem, 'orig_w': w, 'orig_h': h,
                     'source': f'gs://{BUCKET}/{frames[0]}', 'licence': 'CC BY 4.0 (Google SANPO)'})
    if (si + 1) % 25 == 0: print(f'{si + 1}/{len(sessions)} sessions looked at, {with_masks} with masks, {len(rows)} frames', flush=True)

with open(f'{OUT}/manifest.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ['file']); w.writeheader(); w.writerows(rows)
open(f'{OUT}/SOURCE.txt', 'w').write(
    'SANPO-Real subset (Google Research, CC BY 4.0; https://github.com/google-research-datasets/sanpo_dataset).\n'
    'Chest-mounted camera, left lens; frames as JPEG (max 640 px), segmentation masks unchanged (see labelmap.json).\n'
    'TEST ONLY: never train on these. Convert masks to boxes only after checking the label map and mask encoding.\n')
print(f'done: {len(rows)} frames from {with_masks} sessions with masks' + (f'; note: {layout_note}' if layout_note else ''))
