#!/usr/bin/env python3
"""Generate Android/PWA PNG icons from Football Stories' existing crest.

Requires Pillow: python -m pip install Pillow
Run from site-files/: python scripts/build-app-icons.py
"""
from io import BytesIO
from pathlib import Path
import base64
import re
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
header = (ROOT / "site-header.js").read_text(encoding="utf-8")
match = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', header)
if not match:
    raise SystemExit("Could not locate the existing brand PNG in site-header.js")
crest = Image.open(BytesIO(base64.b64decode(match.group(1)))).convert("RGBA")

def icon(size: int, maskable: bool = False) -> Image.Image:
    background = Image.new("RGBA", (size, size), "#f8f7fb")
    # Keep a larger safe zone for adaptive Android launchers.
    target = int(size * (0.62 if maskable else 0.82))
    image = crest.copy()
    image.thumbnail((target, target), Image.Resampling.LANCZOS)
    x = (size - image.width) // 2
    y = (size - image.height) // 2
    background.alpha_composite(image, (x, y))
    return background.convert("RGB")

for size in (192, 512):
    output = ROOT / f"app-icon-{size}.png"
    icon(size).save(output, optimize=True)
    print(output.relative_to(ROOT))
icon(512, maskable=True).save(ROOT / "app-icon-maskable-512.png", optimize=True)
print("app-icon-maskable-512.png")
