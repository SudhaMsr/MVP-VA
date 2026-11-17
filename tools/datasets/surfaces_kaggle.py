# Kaggle notebook cell: fetch public surface datasets (road, sidewalk, crosswalk, curb ramp) as-is and keep them as PRIVATE
# Kaggle datasets for inspection. No conversion yet: we look at the layout first, then write the label mapping.
#   Outdoor Navigation Dataset (Zenodo 14043015, CC BY 4.0, credit Mihai Craciunescu): crosswalk, pedestrian, ramp, road, sidewalk.
#   FPVCrosswalk2025 (Mendeley mcr2jwk5bp, CC BY 4.0): first-person crosswalk masks (3,000 synthetic + 300 real).
# Run in a Kaggle notebook with Internet on. Not run in the app, not used by any shipped model.
import json, os, shutil, urllib.request, zipfile

OUT = '/kaggle/working/surfaces'
os.makedirs(OUT, exist_ok=True)

def get(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'vision-assist-dataset-fetch'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)
    print('got', dest, os.path.getsize(dest) // 1024, 'KB')

def unzip(path, to):
    with zipfile.ZipFile(path) as z:
        z.extractall(to)
    os.remove(path)

# 1. Zenodo
z = f'{OUT}/outdoor_nav.zip'
get('https://zenodo.org/records/14043015/files/outdoor_navigation_dataset.zip?download=1', z)
unzip(z, f'{OUT}/outdoor-navigation')

# 2. Mendeley (public API lists the files; each has a download url)
try:
    meta = json.load(urllib.request.urlopen('https://data.mendeley.com/public-api/datasets/mcr2jwk5bp/files?folder_id=root&version=1', timeout=60))
    for item in meta:
        name = item.get('filename') or item.get('name')
        url = (item.get('content_details') or {}).get('download_url')
        if name and url:
            dest = f'{OUT}/fpvcrosswalk/{name}'
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            get(url, dest)
            if dest.endswith('.zip'):
                unzip(dest, f'{OUT}/fpvcrosswalk')
except Exception as e:
    print('mendeley fetch failed:', type(e).__name__, e)

# What did we get? Print layout so the label mapping can be written from facts.
for root, dirs, files in os.walk(OUT):
    depth = root[len(OUT):].count(os.sep)
    if depth <= 3:
        print(root, len(files), 'files', files[:3])
for yaml in [os.path.join(r, f) for r, _, fs in os.walk(OUT) for f in fs if f.endswith(('.yaml', '.yml'))][:4]:
    print('---', yaml); print(open(yaml).read()[:600])

# Private upload (CC BY credit kept in LICENSE_NOTE).
open(f'{OUT}/LICENSE_NOTE.txt', 'w').write(
    'Outdoor Navigation Dataset, Mihai Craciunescu, Zenodo 10.5281/zenodo.14043015, CC BY 4.0.\n'
    'FPVCrosswalk2025, Mendeley Data mcr2jwk5bp, CC BY 4.0.\nKeep this dataset private; credit both in any shipped model notes.\n')
import kagglehub
kagglehub.dataset_upload('sudharanimsr/surfaces-raw-public', OUT)
print('uploaded private: sudharanimsr/surfaces-raw-public')
