#!/usr/bin/env python3
"""Phase 2, step 1: look inside every dataset folder and report what is there. Standard library only (needs PyYAML only if installed).

Run in WSL:   python3 tools/phase2/inventory.py "/home/sudha/Developer/Vision Assist/data/raw" > inventory.txt
Then send me inventory.txt (or paste it). It lists, per folder: image count, label format, label files, and the class names found.
It only reads; it never changes or moves anything."""
import json, os, re, sys
from collections import Counter

IMG = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

def read_yaml_names(path):
    try:
        import yaml
        d = yaml.safe_load(open(path, encoding='utf-8', errors='ignore'))
        n = d.get('names') if isinstance(d, dict) else None
        if isinstance(n, dict): return [n[k] for k in sorted(n, key=lambda x: int(x))]
        if isinstance(n, list): return n
    except Exception:
        pass
    txt = open(path, encoding='utf-8', errors='ignore').read()  # crude fallback
    m = re.search(r'names:\s*\[(.*?)\]', txt, re.S)
    if m: return [x.strip(" '\"\n") for x in m.group(1).split(',') if x.strip()]
    m = re.search(r'names:\s*\n((?:\s+\d+:.*\n?)+)', txt)
    if m: return [l.split(':', 1)[1].strip(" '\"") for l in m.group(1).splitlines() if ':' in l]
    return []

def scan(root):
    imgs = 0; txt = 0; xml = 0; jsons = []; yamls = []; classes_txt = []; sample_ext = Counter(); size = 0
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f); e = os.path.splitext(f)[1].lower()
            if e in IMG: imgs += 1; sample_ext[e] += 1
            elif e == '.txt':
                if f.lower() in ('classes.txt', 'obj.names', 'labels.txt'): classes_txt.append(p)
                else: txt += 1
            elif e == '.xml': xml += 1
            elif e == '.json': jsons.append(p)
            elif e in ('.yaml', '.yml'): yamls.append(p)
            elif e == '.names': classes_txt.append(p)
            try: size += os.path.getsize(p)
            except OSError: pass
    return dict(imgs=imgs, txt=txt, xml=xml, jsons=jsons, yamls=yamls, classes_txt=classes_txt, size=size)

def coco_json_classes(p):
    try:
        if os.path.getsize(p) > 400_000_000: return None, 'too big to read here'
        d = json.load(open(p, encoding='utf-8', errors='ignore'))
        if isinstance(d, dict) and 'categories' in d:
            return [c.get('name') for c in d['categories']], f"{len(d.get('images', []))} images, {len(d.get('annotations', []))} boxes"
    except Exception as e:
        return None, f'unreadable ({e.__class__.__name__})'
    return None, 'not a COCO annotation file'

def yolo_class_ids(root, limit=4000):
    c = Counter(); n = 0
    for dp, _, fs in os.walk(root):
        if os.sep + 'labels' not in dp + os.sep and 'label' not in dp.lower(): continue
        for f in fs:
            if f.endswith('.txt') and f.lower() not in ('classes.txt', 'labels.txt'):
                n += 1
                if n > limit: return c, n
                try:
                    for line in open(os.path.join(dp, f)):
                        parts = line.split()
                        if len(parts) >= 5 and parts[0].isdigit(): c[int(parts[0])] += 1
                except OSError: pass
    return c, n

def main(root):
    print(f'Inventory of {root}\n')
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d): continue
        s = scan(d)
        fmt = []
        if s['yamls'] or s['txt']: fmt.append('YOLO txt?')
        if s['xml']: fmt.append('VOC xml')
        if s['jsons']: fmt.append('json (COCO/other)')
        print(f"=== {name}: {s['imgs']} images, {s['size']/1e9:.2f} GB, formats: {', '.join(fmt) or 'none found'}")
        for y in s['yamls'][:3]:
            n = read_yaml_names(y)
            if n: print(f"  data yaml {os.path.relpath(y, d)}: {len(n)} classes: {n[:60]}")
        for c in s['classes_txt'][:2]:
            print(f"  class file {os.path.relpath(c, d)}: {[l.strip() for l in open(c, errors='ignore') if l.strip()][:60]}")
        for j in s['jsons'][:4]:
            n, info = coco_json_classes(j)
            if n: print(f"  json {os.path.relpath(j, d)}: {info}; classes: {n[:60]}")
        if s['txt']:
            ids, nfiles = yolo_class_ids(d)
            if ids: print(f"  YOLO label files read: {min(nfiles, 4000)}; class ids used (id:boxes): {dict(sorted(ids.items()))}")
        print()

if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    main(sys.argv[1])
