# Step 1 of the final MVP training plan: audit every training dataset on Kaggle, read-only.
# Run in a Kaggle notebook (CPU is enough, Internet on). One line in a cell:
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/SudhaMsr/MVP-VA/<commit>/tools/datasets/audit_kaggle.py").read())
# Each dataset is attached with kagglehub (mounted, not copied). For every folder of YOLO labels it reports the class
# names (from the nearest data.yaml, or from Pascal VOC XML files that share a file name), boxes per class and split,
# label lines that are polygons or keypoints instead of boxes, empty label files, images without labels and the reverse,
# and a sample of image sizes. Zips inside a dataset are listed, not opened in full. Nothing is written except
# /kaggle/working/audit.md and audit.json.
import os, re, json, glob, collections, zipfile, random, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
THREADS = globals().get('AUDIT_THREADS', 48)  # mounted Kaggle datasets are network storage: read many small files in parallel

DATASETS = globals().get('AUDIT_DATASETS', [
    'sudharanimsr/phase2-rod2-training-data', 'sudharanimsr/vip-mobility360-640px', 'sudharanimsr/vistas-va-yolo640',
    'sudharanimsr/kerbs-yolo640', 'sudharanimsr/potholes-yolo640', 'sudharanimsr/e-scooters-bollards-yolo640',
    'sudharanimsr/open-images-va-classes', 'sudharanimsr/project-sidewalk-tagger-640', 'guidedogrobot/guidetwsi'])
IMG = ('.jpg', '.jpeg', '.png', '.webp', '.bmp')
OUT = '/kaggle/working'
random.seed(0)

try:
    import yaml
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'pyyaml'], check=True); import yaml
import kagglehub
from PIL import Image


def yaml_names(path):
    try:
        n = (yaml.safe_load(open(path)) or {}).get('names')
    except Exception:
        return None
    if isinstance(n, dict): return [str(n[k]) for k in sorted(n, key=lambda x: int(x))]
    if isinstance(n, list): return [str(x) for x in n]
    return None


def nearest_names(d, root):
    while True:
        for f in ('data.yaml', 'dataset.yaml', 'data_old25.yaml'):
            p = os.path.join(d, f)
            if os.path.exists(p) and yaml_names(p): return yaml_names(p), p
        for f in ('classes.txt', 'obj.names', 'classes.names'):
            p = os.path.join(d, f)
            if os.path.exists(p): return [l.strip() for l in open(p) if l.strip()], p
        if os.path.samefile(d, root) or os.path.dirname(d) == d: return None, None
        d = os.path.dirname(d)


def xml_names(xml_path):
    try:
        return re.findall(r'<name>\s*([^<]+?)\s*</name>', open(xml_path, errors='ignore').read())
    except Exception:
        return []


def audit_labels(label_dir, root):
    """One folder of YOLO .txt files: counts per class id, line types, and class names."""
    files = [f for f in os.listdir(label_dir) if f.endswith('.txt') and f not in ('classes.txt',)]
    names, names_from = nearest_names(label_dir, root)
    ids, kinds, empty, bad = collections.Counter(), collections.Counter(), 0, 0
    xml_vote = collections.defaultdict(collections.Counter)
    def read(f):
        p = os.path.join(label_dir, f)
        try:
            lines = [l.split() for l in open(p) if l.strip()]
        except Exception:
            lines = None
        xml = os.path.splitext(p)[0] + '.xml'
        xn = xml_names(xml) if (lines and os.path.exists(xml)) else None
        return lines, xn
    with ThreadPoolExecutor(THREADS) as ex:
        results = list(ex.map(read, files))
    for lines, xn in results:
        if lines is None:
            bad += 1; continue
        if not lines: empty += 1
        for parts in lines:
            try:
                c = int(float(parts[0])); vals = [float(v) for v in parts[1:]]
            except Exception:
                bad += 1; continue
            ids[c] += 1
            kinds['box' if len(vals) == 4 else 'polygon' if len(vals) >= 6 and len(vals) % 2 == 0 else 'keypoint_or_other'] += 1
            if len(vals) >= 4 and not all(0 <= v <= 1.0001 for v in vals[:4]): kinds['out_of_range'] += 1
        if not names and xn:
            if len(xn) == len(lines):
                for parts, n in zip(lines, xn): xml_vote[int(float(parts[0]))][n] += 1
    if not names and xml_vote:
        names_from = 'matched with Pascal VOC .xml files of the same name'
        top = max(xml_vote) + 1
        names = [xml_vote[i].most_common(1)[0][0] if xml_vote[i] else f'id{i}' for i in range(top)]
    return {
        'label_dir': label_dir, 'label_files': len(files), 'empty_files': empty, 'unreadable_lines': bad,
        'names_from': names_from, 'names': names,
        'boxes_per_class': {(names[i] if names and i < len(names) else f'id{i}'): n for i, n in sorted(ids.items())},
        'line_types': dict(kinds),
        'xml_name_votes': {i: dict(v.most_common(3)) for i, v in sorted(xml_vote.items())} if xml_vote else None,
    }


def image_dir_for(label_dir):
    for cand in (label_dir.replace('/labels', '/images'), label_dir):
        if os.path.isdir(cand) and any(f.lower().endswith(IMG) for f in os.listdir(cand)[:2000]): return cand
    return None


def audit_dataset(slug):
    root = kagglehub.dataset_download(slug)
    rep = {'dataset': slug, 'root': root, 'tree': {}, 'zips': [], 'label_dirs': [], 'yaml_files': []}
    ext = collections.Counter()
    for d, dirs, files in os.walk(root):
        rel = os.path.relpath(d, root)
        depth = 0 if rel == '.' else rel.count('/') + 1
        for f in files:
            e = os.path.splitext(f)[1].lower(); ext[e] += 1
            if depth <= 3: rep['tree'].setdefault(rel, collections.Counter())[e] += 1
            if f.endswith('.zip'):
                p = os.path.join(d, f)
                try:
                    z = zipfile.ZipFile(p); n = z.namelist()
                    rep['zips'].append({'zip': os.path.relpath(p, root), 'size_gb': round(os.path.getsize(p) / 1e9, 2),
                                        'entries': len(n), 'first': n[:5],
                                        'ext': dict(collections.Counter(os.path.splitext(x)[1].lower() for x in n).most_common(6))})
                except Exception as ex:
                    rep['zips'].append({'zip': os.path.relpath(p, root), 'error': type(ex).__name__})
            if f in ('data.yaml', 'dataset.yaml', 'data_old25.yaml', 'classes.txt', 'obj.names'):
                p = os.path.join(d, f); rep['yaml_files'].append({'file': os.path.relpath(p, root), 'names': yaml_names(p) if f.endswith('.yaml') else [l.strip() for l in open(p) if l.strip()]})
        if sum(1 for f in files if f.endswith('.txt')) >= 20 and (any('label' in part.lower() for part in rel.split('/')) or any(f.lower().endswith(IMG) for f in files[:50])):
            a = audit_labels(d, root)
            imgs = image_dir_for(d)
            if imgs:
                stems_i = {os.path.splitext(f)[0] for f in os.listdir(imgs) if f.lower().endswith(IMG)}
                stems_l = {os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith('.txt')}
                a['images'] = len(stems_i); a['images_without_label'] = len(stems_i - stems_l); a['labels_without_image'] = len(stems_l - stems_i)
                sizes = collections.Counter()
                for f in random.sample(sorted(stems_i), min(30, len(stems_i))):
                    for e in IMG:
                        p = os.path.join(imgs, f + e)
                        if os.path.exists(p):
                            try: sizes[Image.open(p).size] += 1
                            except Exception: sizes['unreadable'] += 1
                            break
                a['image_size_sample'] = {str(k): v for k, v in sizes.most_common(5)}
            rep['label_dirs'].append(a)
    rep['extensions'] = dict(ext.most_common(12))
    rep['tree'] = {k: dict(v.most_common(4)) for k, v in sorted(rep['tree'].items())[:60]}
    return rep


reports = []
for s in DATASETS:
    try:
        r = audit_dataset(s); reports.append(r)
        print(f"{s}: {sum(r['extensions'].values())} files, {len(r['label_dirs'])} label folders, {len(r['zips'])} zips", flush=True)
    except Exception as ex:
        reports.append({'dataset': s, 'error': f'{type(ex).__name__}: {ex}'}); print(s, 'ERROR', ex, flush=True)
json.dump(reports, open(f'{OUT}/audit.json', 'w'), indent=1, default=str)

md = ['# Vision Assist dataset audit', '']
for r in reports:
    md.append(f"## {r['dataset']}")
    if 'error' in r: md += [f"ERROR: {r['error']}", '']; continue
    md.append(f"Files by type: {r['extensions']}")
    for y in r['yaml_files']: md.append(f"- class list in `{y['file']}`: {y['names']}")
    for z in r['zips']: md.append(f"- zip `{z.get('zip')}`: {z}")
    for a in r['label_dirs']:
        rel = os.path.relpath(a['label_dir'], r['root'])
        md.append(f"- **{rel}**: {a['label_files']} label files, {a.get('images', '?')} images, "
                  f"{a.get('images_without_label', '?')} images with no label file, {a.get('labels_without_image', '?')} labels with no image, "
                  f"{a['empty_files']} empty, {a['unreadable_lines']} unreadable lines; line types {a['line_types']}; "
                  f"names from {a['names_from']}; sizes {a.get('image_size_sample')}")
        md.append(f"  - boxes per class: {a['boxes_per_class']}")
        if a.get('xml_name_votes'): md.append(f"  - id to XML name votes: {a['xml_name_votes']}")
    if not r['label_dirs']: md.append(f"- no YOLO label folders found; folder tree: {r['tree']}")
    md.append('')
open(f'{OUT}/audit.md', 'w').write('\n'.join(md))
print('\n'.join(md))
