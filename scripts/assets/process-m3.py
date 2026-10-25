"""M3 image pipeline: raw fal images in assets/raw/m3 -> game textures in public/textures.

Tiles are resized to 1024 webp. Cutouts generated on white get their background
keyed to alpha by distance from white, trimmed, resized and saved as webp with alpha.
Run: python3 -I scripts/assets/process-m3.py
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'assets/raw/m3')
OUT = os.path.join(ROOT, 'public/textures')

TILES = {'asphalt': 768, 'gravel': 512, 'grass': 768, 'stubble': 768}
# name: (output width, key softness lo..hi on distance from white, crop box fractions or None)
CUTOUTS = {
    'tree': (384, (10, 40), None),
    'shelterbelt': (1024, (10, 40), None),
    'farmyard': (1024, (14, 40), None),  # studio backdrop is a gradient: keyed per row
    'skyline': (2048, (6, 120), None),  # wide ramp: the orange haze fades into the sky
}


def key_white(img, lo, hi, per_row=True):
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    # Background per row, interpolated between the left and right margins, so a
    # studio gradient keys as cleanly as flat white.
    W = a.shape[1]
    left = a[:, :64].mean(1, keepdims=True)
    right = a[:, -64:].mean(1, keepdims=True)
    t = np.linspace(0, 1, W)[None, :, None]
    bg = left * (1 - t) + right * t
    if not per_row:  # flat backdrop sampled from the top corners
        bg = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3)]).mean(0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((d - lo) / (hi - lo), 0, 1)
    # un-premultiply the white so edges don't carry a halo
    al = np.maximum(alpha[..., None], 1e-3)
    rgb = np.clip((a - bg * (1 - al)) / al, 0, 255)
    rgb = np.where(alpha[..., None] > 0.02, rgb, 0)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size in TILES.items():
        im = Image.open(os.path.join(RAW, f'{name}.png')).convert('RGB').resize((size, size), Image.LANCZOS)
        p = os.path.join(OUT, f'{name}.webp')
        im.save(p, 'WEBP', quality=66, method=6)
        print(name, im.size, os.path.getsize(p))
    for name, (w, (lo, hi), crop) in CUTOUTS.items():
        im = Image.open(os.path.join(RAW, f'{name}.png'))
        if crop:
            W, H = im.size
            im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
        im = key_white(im, lo, hi, per_row=name != 'skyline')
        bbox = im.getchannel('A').point(lambda v: 255 if v > 96 else 0).getbbox()
        im = im.crop(bbox)
        h = round(im.height * w / im.width)
        im = im.resize((w, h), Image.LANCZOS)
        p = os.path.join(OUT, f'{name}.webp')
        im.save(p, 'WEBP', quality=80, method=6)
        print(name, im.size, os.path.getsize(p))


if __name__ == '__main__':
    sys.exit(main())
