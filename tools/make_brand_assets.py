"""TEMPORARY brand-card generator - not committed.

Draws the three raster assets in the CURRENT light/editorial brand:
  favicon.png (512), apple-touch-icon.png (180), social-preview.png (1200x630)

The mark is the same geometry the header uses:
  <circle cx=24 cy=24 r=15 stroke=3/> + <rect x=15 y=22.5 w=18 h=3/>
  + <rect rotated -45deg about (24,24) x=22.5 y=38.5 w=3 h=7.5/>
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = Path("C:/Windows/Fonts")

BG = (247, 245, 239)      # --bg  #F7F5EF
INK = (21, 23, 28)        # --text #15171C
NAVY = (29, 53, 87)       # --blue #1D3557
MUTED = (91, 95, 107)     # --muted #5B5F6B
BORDER = (226, 223, 213)  # --border #E2DFD5
WHITE = (255, 255, 255)


def mark(draw, cx, cy, size, color=NAVY, stroke_ratio=3 / 48):
    """Draw the AQMath mark scaled so the 48-unit viewBox fits `size` px."""
    s = size / 48.0
    lw = max(1, round(3 * s))
    r = 15 * s
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=lw)
    # horizontal hand
    draw.rectangle([cx + (15 - 24) * s, cy + (22.5 - 24) * s,
                    cx + (33 - 24) * s, cy + (25.5 - 24) * s], fill=color)
    # rotated stem: rotate the rect about the viewBox centre by -45 degrees
    ang = math.radians(-45)
    corners = [(22.5, 38.5), (25.5, 38.5), (25.5, 46.0), (22.5, 46.0)]
    pts = []
    for x, y in corners:
        dx, dy = x - 24, y - 24
        rx = dx * math.cos(ang) - dy * math.sin(ang)
        ry = dx * math.sin(ang) + dy * math.cos(ang)
        pts.append((cx + rx * s, cy + ry * s))
    draw.polygon(pts, fill=color)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def icon(size, pad_ratio, path):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    mark(d, size / 2, size / 2, size * (1 - 2 * pad_ratio))
    img.save(ROOT / path, optimize=True)
    print("wrote", path, img.size)


def social(path):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # frame
    d.rectangle([0, 0, W - 1, H - 1], outline=BORDER, width=2)
    # top accent rule
    d.rectangle([0, 0, W, 6], fill=NAVY)

    # logo lockup
    mark(d, 96, 86, 46)
    d.text((132, 66), "AQMath", font=font("georgiab.ttf", 30), fill=INK)

    # eyebrow
    eyebrow = "PORTFOLIO MATHEMATICS  ·  NON-CUSTODIAL  ·  FREE APP & BACKTEST"
    f_eb = font("consolab.ttf", 19)
    x = 96
    for ch in eyebrow:
        d.text((x, 168), ch, font=f_eb, fill=MUTED)
        x += d.textlength(ch, font=f_eb) + 1.6

    # headline
    f_h = font("georgiab.ttf", 74)
    lines = ["Portfolio mathematics", "you can audit line", "by line."]
    y = 220
    for line in lines:
        d.text((92, y), line, font=f_h, fill=INK)
        y += 88

    # footer row
    d.line([(96, 512), (W - 96, 512)], fill=BORDER, width=2)
    f_f = font("segoeui.ttf", 22)
    d.text((96, 540), "Risk Parity (ERC + KKT)  ·  Deleverage Shield  ·  DCA distribution",
           font=f_f, fill=MUTED)
    f_site = font("consolab.ttf", 24)
    tw = d.textlength("aqmath.xyz", font=f_site)
    d.text((W - 96 - tw, 536), "aqmath.xyz", font=f_site, fill=NAVY)

    img.save(ROOT / path, optimize=True)
    print("wrote", path, img.size)


if __name__ == "__main__":
    icon(512, 0.13, "favicon.png")
    icon(180, 0.10, "apple-touch-icon.png")
    social("social-preview.png")
    # small multi-size .ico from the same 512 master
    master = Image.open(ROOT / "favicon.png")
    master.save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.ico")
