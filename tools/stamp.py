#!/usr/bin/env python3
"""Stamp docs/index.html with a version that changes whenever any script changes.
GitHub Pages lets browsers reuse a script for up to 10 minutes, so right after an update a phone can run a mix of old and
new files. The import map below gives every script a version in its address, so a new version is always fetched fresh.
Run after editing anything in docs/js:  python3 tools/stamp.py
It also writes the version and the list of files to keep offline into docs/sw.js (Package B), so every release changes the
service worker and phones pick up the new app shell.
"""
import hashlib, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent / 'docs'
files = sorted((root / 'js').glob('*.js'))
ver = hashlib.sha1(b''.join(f.read_bytes() for f in files)).hexdigest()[:7]
imports = ',\n    '.join(f'"./js/{f.name}": "./js/{f.name}?v={ver}"' for f in files)
block = f'<!--stamp-->\n<script type="importmap">{{"imports": {{\n    {imports}\n}}}}</script>\n<!--/stamp-->'
html = (root / 'index.html').read_text()
html = re.sub(r'<!--stamp-->.*?<!--/stamp-->', block, html, flags=re.S) if '<!--stamp-->' in html else html.replace('<script src="https://cdn.jsdelivr.net', block + '\n<script src="https://cdn.jsdelivr.net', 1)
html = re.sub(r'<script type="module" src="js/app\.js[^"]*">', f'<script type="module" src="js/app.js?v={ver}">', html)
if 'id="ver"' in html:
    html = re.sub(r'(<span id="ver">)[^<]*(</span>)', rf'\g<1>{ver}\2', html)
(root / 'index.html').write_text(html)
print('stamped', ver)

# The offline app shell (docs/sw.js): every page, every script at its stamped address, the detection runtime the phone
# normally uses (the other runtime files are cached the first time they are fetched), the manifest and the icons.
pages = ['./', 'index.html'] + sorted(p.name for p in root.glob('*.html') if p.name != 'index.html')
shell = pages + [f'js/{f.name}?v={ver}' for f in files] + ['vendor/ort/ort.min.js', 'vendor/ort/ort-wasm-simd.wasm', 'manifest.webmanifest'] \
    + sorted(f'icons/{p.name}' for p in (root / 'icons').glob('*.png'))
sw = root / 'sw.js'
if sw.exists():
    listing = ',\n  '.join(f"'{u}'" for u in shell)
    text = re.sub(r'/\* stamp \*/.*?/\* /stamp \*/', f"/* stamp */\nconst VERSION = '{ver}';\nconst PRECACHE = [\n  {listing},\n];\n/* /stamp */", sw.read_text(), flags=re.S)
    sw.write_text(text)
    print('stamped sw.js with', len(shell), 'files')
