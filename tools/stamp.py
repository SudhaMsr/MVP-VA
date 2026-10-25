#!/usr/bin/env python3
"""Stamp docs/index.html with a version that changes whenever any script changes.
GitHub Pages lets browsers reuse a script for up to 10 minutes, so right after an update a phone can run a mix of old and
new files. The import map below gives every script a version in its address, so a new version is always fetched fresh.
Run after editing anything in docs/js:  python3 tools/stamp.py
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
