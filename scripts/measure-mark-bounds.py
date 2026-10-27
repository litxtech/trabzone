"""Measure where the actual mark sits inside the supplied artwork.

The artwork is a glossy rounded tile: the mark is the high-frequency content,
the tile background is a smooth gradient. A high-pass filter therefore isolates
the mark without relying on hue (which the background shares).
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "source"

for name in ("android-aurora.png", "android-orbit.png", "android-nova.png"):
    img = Image.open(SOURCE / name).convert("RGB")
    blurred = img.filter(ImageFilter.GaussianBlur(48))
    diff = np.abs(np.asarray(img, dtype=np.float32) - np.asarray(blurred, dtype=np.float32)).mean(axis=2)
    h, w = diff.shape
    # ignore the tile rim itself
    inner = diff[int(h * 0.06) : int(h * 0.94), int(w * 0.06) : int(w * 0.94)]
    threshold = inner.max() * 0.22
    ys, xs = np.where(inner > threshold)
    print(
        f"{name:20s} energy-max={inner.max():5.1f} "
        f"mark bbox x=[{xs.min()/inner.shape[1]:.3f},{xs.max()/inner.shape[1]:.3f}] "
        f"y=[{ys.min()/inner.shape[0]:.3f},{ys.max()/inner.shape[0]:.3f}]"
    )
