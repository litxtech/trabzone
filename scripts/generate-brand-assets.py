"""Trabzone app icon pipeline.

Generates every launcher / splash asset from the approved brand artwork.

Android adaptive icons are NOT produced by scaling the full artwork full-bleed:
the system mask would crop the glyph. Instead the artwork is centred inside the
108dp canvas with ~74% coverage so the mark stays inside the 66dp safe zone,
and a blurred extension of the artwork fills the background layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand" / "source"
OUT_ICONS = ROOT / "assets" / "brand" / "icons"
OUT_SPLASH = ROOT / "assets" / "brand" / "splash"
OUT_PREVIEW = ROOT / "assets" / "brand" / "preview"

ADAPTIVE_CANVAS = 1024
# Android masks the central 72dp of the 108dp canvas (66.7%). The approved
# artwork already keeps its glyph inside that window, so the foreground is a
# full-bleed copy: no shrunken tile, no clipped corners, glyph stays centred.
ADAPTIVE_VISIBLE_RATIO = 72 / 108
IOS_SIZE = 1024
SPLASH_SIZE = 512


@dataclass(frozen=True)
class Variant:
    key: str
    title: str
    ios_source: str
    android_source: str


VARIANTS = (
    Variant("aurora", "Aurora", "ios-aurora.png", "android-aurora.png"),
    Variant("orbit", "Orbit", "ios-orbit.png", "android-orbit.png"),
    Variant("nova", "Nova", "ios-nova.png", "android-nova.png"),
)


def load_rgb(name: str) -> Image.Image:
    return Image.open(SOURCE / name).convert("RGB")


def rounded_mask(size: int, radius_ratio: float = 0.2237) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * radius_ratio), fill=255
    )
    return mask


def ios_icon(art: Image.Image) -> Image.Image:
    """Opaque 1024 square: iOS applies its own rounded mask."""
    return art.resize((IOS_SIZE, IOS_SIZE), Image.LANCZOS)


def adaptive_background(art: Image.Image) -> Image.Image:
    """Full-bleed 1024 layer: the artwork's own background, softly extended."""
    base = art.resize((ADAPTIVE_CANVAS, ADAPTIVE_CANVAS), Image.LANCZOS)
    base = base.filter(ImageFilter.GaussianBlur(72))
    base = ImageEnhance.Brightness(base).enhance(0.94)
    base = ImageEnhance.Color(base).enhance(1.08)

    # Gentle vignette so the centred tile separates from the background layer.
    vignette = Image.new("L", (ADAPTIVE_CANVAS, ADAPTIVE_CANVAS), 0)
    ImageDraw.Draw(vignette).ellipse(
        (-ADAPTIVE_CANVAS * 0.25, -ADAPTIVE_CANVAS * 0.25, ADAPTIVE_CANVAS * 1.25, ADAPTIVE_CANVAS * 1.25),
        fill=255,
    )
    vignette = vignette.filter(ImageFilter.GaussianBlur(140))
    darkened = ImageEnhance.Brightness(base).enhance(0.8)
    return Image.composite(base, darkened, vignette)


def adaptive_foreground(art: Image.Image) -> Image.Image:
    """Full-bleed 1024 layer.

    Android crops the outer band itself, so shipping the artwork 1:1 keeps the
    glyph as large as the approved design while the 72dp mask never touches it.
    A square tile scaled down to ~66% would instead have its corners cut by the
    launcher circle, which is exactly the cramped look to avoid.
    """
    return art.convert("RGBA").resize((ADAPTIVE_CANVAS, ADAPTIVE_CANVAS), Image.LANCZOS)


def monochrome(art: Image.Image) -> Image.Image:
    """White silhouette of the glyph for Android 13 themed icons."""
    rgb = art.convert("RGB")
    hsv = rgb.convert("HSV")
    _, saturation, value = hsv.split()
    alpha = Image.new("L", rgb.size, 0)
    alpha.putdata(
        [255 if (s > 46 and v > 40) or v < 60 else 0 for s, v in zip(saturation.getdata(), value.getdata())]
    )
    alpha = alpha.filter(ImageFilter.GaussianBlur(1))
    silhouette = Image.new("RGBA", rgb.size, (255, 255, 255, 0))
    silhouette.putalpha(alpha)
    return silhouette


def splash_logo(art: Image.Image) -> Image.Image:
    logo = art.resize((SPLASH_SIZE, SPLASH_SIZE), Image.LANCZOS).convert("RGBA")
    logo.putalpha(rounded_mask(SPLASH_SIZE))
    return logo


def preview_sheet(entries: list[tuple[str, Image.Image]]) -> Image.Image:
    cell, pad = 340, 44
    sheet = Image.new("RGB", (pad + (cell + pad) * len(entries), cell + pad * 2 + 26), (244, 246, 251))
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(entries):
        x = pad + index * (cell + pad)
        draw.rounded_rectangle((x, pad, x + cell, pad + cell), radius=34, fill=(255, 255, 255))
        square = image.convert("RGBA").resize((cell - 40, cell - 40), Image.LANCZOS)
        sheet.paste(square, (x + 20, pad + 20), square)
        draw.text((x + 6, pad + cell + 8), label, fill=(23, 34, 56))
    return sheet


def run() -> None:
    for directory in (OUT_ICONS, OUT_SPLASH, OUT_PREVIEW):
        directory.mkdir(parents=True, exist_ok=True)

    visible = int(ADAPTIVE_CANVAS * ADAPTIVE_VISIBLE_RATIO)
    inset = (ADAPTIVE_CANVAS - visible) // 2
    mask_preview = Image.new("RGBA", (ADAPTIVE_CANVAS, ADAPTIVE_CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(mask_preview).ellipse(
        (inset, inset, inset + visible, inset + visible), fill=(255, 255, 255, 255)
    )

    masked_entries: list[tuple[str, Image.Image]] = []
    for variant in VARIANTS:
        ios_art = load_rgb(variant.ios_source)
        android_art = load_rgb(variant.android_source)

        ios_icon(ios_art).save(OUT_ICONS / f"icon-{variant.key}.png", optimize=True)
        background = adaptive_background(android_art)
        foreground = adaptive_foreground(android_art)
        background.save(OUT_ICONS / f"adaptive-background-{variant.key}.png", optimize=True)
        foreground.save(OUT_ICONS / f"adaptive-foreground-{variant.key}.png", optimize=True)
        monochrome(android_art).save(OUT_ICONS / f"monochrome-{variant.key}.png", optimize=True)
        splash_logo(ios_art).save(OUT_SPLASH / f"logo-{variant.key}.png", optimize=True)

        # Circle-mask preview = worst case Android launcher.
        composed = Image.alpha_composite(background.convert("RGBA"), foreground)
        circle = Image.new("RGBA", composed.size, (0, 0, 0, 0))
        circle.paste(composed, (0, 0), mask_preview)
        masked_entries.append((variant.title, circle))

    preview_sheet(masked_entries).save(OUT_PREVIEW / "adaptive-circle-preview.png", optimize=True)
    preview_sheet(
        [(v.title, Image.open(OUT_ICONS / f"icon-{v.key}.png")) for v in VARIANTS]
    ).save(OUT_PREVIEW / "ios-preview.png", optimize=True)

    # Default icon = first approved artwork.
    default = OUT_ICONS / "icon-aurora.png"
    (OUT_ICONS / "icon.png").write_bytes(default.read_bytes())
    (OUT_ICONS / "adaptive-foreground.png").write_bytes(
        (OUT_ICONS / "adaptive-foreground-aurora.png").read_bytes()
    )
    (OUT_ICONS / "adaptive-background.png").write_bytes(
        (OUT_ICONS / "adaptive-background-aurora.png").read_bytes()
    )
    (OUT_ICONS / "monochrome.png").write_bytes((OUT_ICONS / "monochrome-aurora.png").read_bytes())
    (OUT_SPLASH / "splash-logo.png").write_bytes((OUT_SPLASH / "logo-aurora.png").read_bytes())

    # Android 13+ themed icon must be a 108dp-safe silhouette.
    themed = monochrome(load_rgb("android-aurora.png")).resize((432, 432), Image.LANCZOS)
    themed_canvas = Image.new("RGBA", (1024, 1024), (255, 255, 255, 0))
    themed_canvas.alpha_composite(themed, ((1024 - 432) // 2, (1024 - 432) // 2))
    themed_canvas.save(OUT_ICONS / "themed-monochrome.png", optimize=True)

    print("Generated icons:")
    for path in sorted(OUT_ICONS.iterdir()):
        print(f"  {path.relative_to(ROOT)}")


if __name__ == "__main__":
    run()
