"""Marketing screenshots for the App Store: a headline, a subline and the simulator screenshot on a gradient.

Usage: python scripts/compose-screens.py <raw-dir> <out-dir>
Raw screenshots come from the screenshots.yml workflow (1206x2622, iPhone 6.3"); output has the same size.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1206, 2622
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


def gradient(top, bottom):
    g = Image.new('RGB', (1, H))
    for y in range(H):
        t = y / (H - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((W, H))


def rounded(img, r):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), r, fill=255)
    out = Image.new('RGBA', img.size)
    out.paste(img, (0, 0), mask)
    return out


def compose(raw: Path, title: str, sub: str, out: Path, dark: bool):
    bg = gradient((30, 38, 92), (88, 64, 200)) if dark else gradient((92, 132, 255), (120, 96, 245))
    canvas = bg.convert('RGBA')
    d = ImageDraw.Draw(canvas)
    f1 = ImageFont.truetype(BOLD, 96)
    f2 = ImageFont.truetype(SEMI, 52)
    y = 170
    while d.textlength(title, font=f1) > W - 140 and f1.size > 60:
        f1 = ImageFont.truetype(BOLD, f1.size - 4)
    for text, font, fill, gap in ((title, f1, (255, 255, 255), 26), (sub, f2, (230, 232, 255), 0)):
        w = d.textlength(text, font=font)
        d.text(((W - w) / 2, y), text, font=font, fill=fill)
        y += font.size + gap + 14
    shot = Image.open(raw).convert('RGB')
    scale = 0.80
    sw, sh = int(W * scale), int(H * scale)
    shot = rounded(shot.resize((sw, sh), Image.LANCZOS), 70)
    x, top = (W - sw) // 2, y + 90
    shadow = Image.new('RGBA', (sw + 120, sh + 120), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((60, 70, sw + 60, sh + 70), 80, fill=(10, 10, 40, 150))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(36)), (x - 60, top - 60))
    border = Image.new('RGBA', (sw + 16, sh + 16), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((0, 0, sw + 15, sh + 15), 78, fill=(18, 18, 24, 255))
    canvas.alpha_composite(border, (x - 8, top - 8))
    canvas.alpha_composite(shot, (x, top))
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
