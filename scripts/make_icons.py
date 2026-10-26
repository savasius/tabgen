"""Draw the TabGen icon (the sidebar logo: four strings, two fretted notes) at app-icon sizes.

  .venv/bin/python scripts/make_icons.py [--mac out_dir]

Writes the web/PWA icons into apps/web/public; with --mac, also the macOS iconset PNGs.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps" / "web" / "public"
BG = (251, 123, 40)   # --primary (dark theme)
FG = (28, 18, 12)     # --primary-foreground (dark theme)
SS = 4                # supersampling


def glyph(d: ImageDraw.ImageDraw, x0: float, y0: float, size: float) -> None:
    """The 24-unit logo glyph scaled into a size x size box at (x0, y0), centred."""
    u = size / 24
    w = 1.8 * u
    for x in (6, 10, 14, 18):  # the logo's 7..19, shifted to sit centred
        d.line([(x0 + x * u, y0 + 5 * u), (x0 + x * u, y0 + 19 * u)], fill=FG + (140,), width=round(w))
    for cx, cy in ((10, 10), (14, 14)):
        r = 1.8 * u + w / 2
        d.ellipse([x0 + cx * u - r, y0 + cy * u - r, x0 + cx * u + r, y0 + cy * u + r], fill=FG + (255,))


def tile(px: int, glyph_frac: float, radius_frac: float = 0.0) -> Image.Image:
    n = px * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=round(n * radius_frac), fill=BG + (255,))
    g = n * glyph_frac
    glyph(d, (n - g) / 2, (n - g) / 2, g)
    return im.resize((px, px), Image.LANCZOS)


def mac_icon(px: int) -> Image.Image:
    """macOS Big Sur grid: an 824/1024 rounded square with a soft drop shadow."""
    n = px * SS
    body = round(n * 824 / 1024)
    off = (n - body) // 2
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [off, off + n * 0.012, off + body, off + body + n * 0.012], radius=round(body * 0.225), fill=(0, 0, 0, 90))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(n * 0.012)))
    im.alpha_composite(tile(body // SS, 0.85, 0.225).resize((body, body), Image.LANCZOS), (off, off))
    return im.resize((px, px), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<rect width="24" height="24" rx="5.4" fill="#fb7b28"/>
<g stroke="#1c120c" stroke-width="1.8" fill="none">
<path d="M6 5v14M10 5v14M14 5v14M18 5v14" opacity=".55"/>
<circle cx="10" cy="10" r="1.8" fill="#1c120c"/><circle cx="14" cy="14" r="1.8" fill="#1c120c"/>
</g></svg>
"""


def main() -> None:
    # full-bleed squares; the OS rounds them. Maskable icons keep the glyph inside the 80% safe zone.
    tile(512, 0.8).save(PUBLIC / "icon-512.png")
    tile(192, 0.8).save(PUBLIC / "icon-192.png")
    tile(180, 0.85).save(PUBLIC / "apple-touch-icon.png")
    (PUBLIC / "favicon.svg").write_text(SVG)
    if "--mac" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--mac") + 1])
        out.mkdir(parents=True, exist_ok=True)
        for s in (16, 32, 128, 256, 512):
            mac_icon(s).save(out / f"icon_{s}x{s}.png")
            mac_icon(s * 2).save(out / f"icon_{s}x{s}@2x.png")


if __name__ == "__main__":
    main()
