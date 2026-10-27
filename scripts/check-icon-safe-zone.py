"""Sanity check: the Android adaptive icon glyph must stay inside the 66dp safe circle."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "source"
SAFE_DIAMETER = 1024 * (66 / 108)  # ~626px circle inside the 1024px canvas
ART_RATIO = 0.74


def glyph_box(image: Image.Image) -> tuple[float, float, float, float]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    min_x, min_y, max_x, max_y = width, height, 0, 0
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y][:3]
            high, low = max(r, g, b), min(r, g, b)
            saturation = 0 if high == 0 else (high - low) / high
            if saturation > 0.35 and b > 64:
                min_x, min_y = min(min_x, x), min(min_y, y)
                max_x, max_y = max(max_x, x), max(max_y, y)
    return min_x / width, min_y / height, max_x / width, max_y / height


for name in ("android-aurora.png", "android-orbit.png", "android-nova.png"):
    art = Image.open(SOURCE / name)
    left, top, right, bottom = glyph_box(art)
    width = (right - left) * 1024 * ART_RATIO
    height = (bottom - top) * 1024 * ART_RATIO
    diagonal = (width**2 + height**2) ** 0.5
    status = "OK" if diagonal <= SAFE_DIAMETER else "CROPPED"
    print(
        f"{name:20s} glyph={width:6.1f}x{height:6.1f}px "
        f"diagonal={diagonal:6.1f}px safe={SAFE_DIAMETER:.0f}px -> {status}"
    )
