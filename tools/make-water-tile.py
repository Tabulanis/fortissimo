#!/usr/bin/env python3
"""make-water-tile.py — an ANIMATED HEIGHT MAP of rain-drop rings that repeats in x, y AND time
(owner, 2026-10-06: "build a texture, make it repeatable in x, y and T").

Each drop is a ring expanding from a random point; distances wrap around the tile edges
(toroidal), and each drop's life is a fraction of the loop so its phase wraps too: frame 0
follows frame N-1 seamlessly. Written as a frame ATLAS (COLS x ROWS frames of SIZE px) in
public/textures/water-drops.png, height 0..1 (mid-grey = flat), plus water-drops.json with
the layout. The sea shader scrolls it and blends between frames.
    python3 tools/make-water-tile.py [size=256] [frames=32] [drops=70]"""
import json, sys
import numpy as np
from PIL import Image
from pathlib import Path

SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 256
FRAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 32
DROPS = int(sys.argv[3]) if len(sys.argv) > 3 else 70
COLS = 8; ROWS = -(-FRAMES // COLS)
rng = np.random.default_rng(7)
out = Path(__file__).resolve().parent.parent / "public" / "textures"

# the tile is 1 x 1 in uv; a drop at (cx, cy) born at phase t0 rings outward at speed v,
# fading as it goes; life = how much of the loop it lasts (< 1 so it dies before being reborn)
cx, cy = rng.random(DROPS), rng.random(DROPS)
t0 = rng.random(DROPS)
speed = rng.uniform(0.35, 0.6, DROPS)            # uv per loop
amp = rng.uniform(0.5, 1.0, DROPS)
width = rng.uniform(0.012, 0.03, DROPS)           # ring thickness (uv)
life = rng.uniform(0.55, 0.85, DROPS)
k = rng.uniform(80, 160, DROPS)                   # ring wavelength

u = (np.arange(SIZE) + 0.5) / SIZE
U, V = np.meshgrid(u, u)
atlas = np.zeros((ROWS * SIZE, COLS * SIZE), np.float32)
for f in range(FRAMES):
    t = f / FRAMES
    h = np.zeros((SIZE, SIZE), np.float32)
    for i in range(DROPS):
        age = (t - t0[i]) % 1.0                      # phase since birth, wrapping in T
        if age > life[i]: continue
        dx = (U - cx[i] + 0.5) % 1.0 - 0.5           # toroidal distance: wraps in x and y
        dy = (V - cy[i] + 0.5) % 1.0 - 0.5
        d = np.sqrt(dx * dx + dy * dy)
        r = age * speed[i]
        env = np.exp(-((d - r) / width[i]) ** 2) * amp[i] * (1 - age / life[i]) * np.exp(-age * 2.0)
        h += env * np.cos((d - r) * k[i]) * (0.2 + 0.8 * np.exp(-r * 3))   # the ring thins as it spreads
    atlas[(f // COLS) * SIZE:(f // COLS + 1) * SIZE, (f % COLS) * SIZE:(f % COLS + 1) * SIZE] = h
peak = max(1e-6, np.abs(atlas).max())
img = np.clip(0.5 + 0.5 * atlas / peak, 0, 1)
Image.fromarray((img * 255).astype(np.uint8), "L").save(out / "water-drops.png", optimize=True)
json.dump({"size": SIZE, "frames": FRAMES, "cols": COLS, "rows": ROWS, "peak": float(peak)}, open(out / "water-drops.json", "w"))
print(f"wrote water-drops.png {COLS * SIZE}x{ROWS * SIZE} ({FRAMES} frames of {SIZE}px), peak {peak:.2f}")
