"""Marketing screenshots for the App Store: a headline, a subline and the simulator screenshot on a gradient.

Usage: python scripts/compose-screens.py <raw-dir> <out-dir>
Raw screenshots come from the screenshots.yml workflow (1206x2622, iPhone 6.3"); output has the same size.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ORDER = [
    ('chart', 'Charts from any CSV', 'Bar, line and scatter in one tap'),
    ('files', 'Open CSV, Excel, JSON', 'Straight from the Files app'),
    ('viewer', 'A fast table viewer', 'Sort, search, filter and edit'),
    ('map', 'Put your data on a map', 'GeoJSON, KML, GPX and more'),
    ('stats', 'Understand every column', 'Ranges, averages, top values'),
    ('trend', 'See trends over time', 'Monthly totals, ready made'),
    ('log', 'Logs and text files too', 'Levels and top words, charted'),
]
BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
SEMI = 'C:/Windows/Fonts/seguisb.ttf'


def gradient(top, bottom, w, h):
    g = Image.new('RGB', (1, h))
    for y in range(h):
        t = y / (h - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, h))


def rounded(img, r):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), r, fill=255)
    out = Image.new('RGBA', img.size)
    out.paste(img, (0, 0), mask)
    return out


def compose(raw: Path, title: str, sub: str, out: Path, dark: bool):
    """Same size as the raw screenshot (iPhone, iPad or iPhone Duo); type and margins scale with the width."""
    shot = Image.open(raw).convert('RGB')
    w, h = shot.size
    k = w / 1206
    bg = gradient((30, 38, 92), (88, 64, 200), w, h) if dark else gradient((92, 132, 255), (120, 96, 245), w, h)
    canvas = bg.convert('RGBA')
    d = ImageDraw.Draw(canvas)
    f1 = ImageFont.truetype(BOLD, int(96 * k))
    f2 = ImageFont.truetype(SEMI, int(52 * k))
    y = int(170 * k) if h / w > 1.6 else int(110 * k)
    while d.textlength(title, font=f1) > w - 140 * k and f1.size > 40:
        f1 = ImageFont.truetype(BOLD, f1.size - 4)
    for text, font, fill, gap in ((title, f1, (255, 255, 255), 26 * k), (sub, f2, (230, 232, 255), 0)):
        tw = d.textlength(text, font=font)
        d.text(((w - tw) / 2, y), text, font=font, fill=fill)
        y += font.size + gap + 14 * k
    top = int(y + 80 * k)
    sh = min(int(h * 0.80), h - top - int(50 * k))
    sw = int(sh * w / h)
    r = int(70 * k * sw / (w * 0.8))
    img = rounded(shot.resize((sw, sh), Image.LANCZOS), r)
    x = (w - sw) // 2
    pad = int(60 * k)
    shadow = Image.new('RGBA', (sw + 2 * pad, sh + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 10, sw + pad, sh + pad + 10), r + 10, fill=(10, 10, 40, 150))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(int(36 * k))), (x - pad, top - pad))
    b = max(6, int(8 * k))
    border = Image.new('RGBA', (sw + 2 * b, sh + 2 * b), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((0, 0, sw + 2 * b - 1, sh + 2 * b - 1), r + b, fill=(18, 18, 24, 255))
    canvas.alpha_composite(border, (x - b, top - b))
    canvas.alpha_composite(img, (x, top))
    canvas.convert('RGB').save(out, optimize=True)


def main():
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for i, (name, title, sub) in enumerate(ORDER, 1):
        src = raw / f'{name}.png'
        if not src.exists():
            print('missing', name)
            continue
        dark = name in ('files', 'viewer', 'stats', 'chart', 'log')
        compose(src, title, sub, out / f'{i}-{name}.png', dark)
        print('saved', i, name)


if __name__ == '__main__':
    main()
