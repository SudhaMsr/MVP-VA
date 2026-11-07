#!/usr/bin/env python3
"""Make the home-screen icons for docs/manifest.webmanifest (Package B).
High contrast and no text: a yellow ring with a yellow centre (an eye) on black, the app's own colours.
The maskable icon keeps the shape inside the middle 80% so Android can crop it to any shape.
Run: python3 tools/make_icons.py   (needs Pillow)
"""
import pathlib
from PIL import Image, ImageDraw

YELLOW, BLACK = (255, 212, 0, 255), (0, 0, 0, 255)
out = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'icons'
out.mkdir(exist_ok=True)


def icon(size, scale):
    """scale: the eye's outer radius as a share of half the icon (1.0 touches the edges)."""
    big = size * 4  # draw large, then shrink, for smooth edges
    im = Image.new('RGBA', (big, big), BLACK)
    d = ImageDraw.Draw(im)
    c, r = big / 2, big / 2 * scale
    ring = r * 0.22
    d.ellipse([c - r, c - r, c + r, c + r], fill=YELLOW)
    d.ellipse([c - r + ring, c - r + ring, c + r - ring, c + r - ring], fill=BLACK)
    p = r * 0.38
    d.ellipse([c - p, c - p, c + p, c + p], fill=YELLOW)
    return im.resize((size, size), Image.LANCZOS)


for name, size, scale in [('icon-192.png', 192, 0.86), ('icon-512.png', 512, 0.86), ('maskable-512.png', 512, 0.62),
                          ('apple-touch-icon.png', 180, 0.74)]:
    icon(size, scale).save(out / name, optimize=True)
    print('wrote', out / name)
