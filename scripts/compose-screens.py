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


def mark_fold(shot, fold: float, label: str):
    """A dashed line where the iPhone Duo folds, with a small label, to show the layout splits at the fold."""
    w, h = shot.size
    x = int(w * fold)
    layer = Image.new('RGBA', shot.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    dash, gap, lw = int(h * 0.022), int(h * 0.014), max(4, int(w * 0.0022))
    y = int(h * 0.10)
    while y < h:
        d.rectangle((x - lw // 2 - 2, y - 2, x + lw // 2 + 2, min(y + dash, h) + 2), fill=(0, 0, 0, 90))
        d.rectangle((x - lw // 2, y, x + lw // 2, min(y + dash, h)), fill=(255, 255, 255, 200))
        y += dash + gap
    f = ImageFont.truetype(SEMI, int(h * 0.024))
    tw = d.textlength(label, font=f)
    px, py = int(h * 0.014), int(h * 0.007)
    top = int(h * 0.045)
    box = (x - tw / 2 - px, top, x + tw / 2 + px, top + f.size + 2 * py)
    d.rounded_rectangle(box, radius=(box[3] - box[1]) / 2, fill=(255, 255, 255, 235))
    d.text((x - tw / 2, top + py - int(f.size * 0.12)), label, font=f, fill=(40, 40, 60, 255))
    out = shot.convert('RGBA')
    out.alpha_composite(layer)
    return out.convert('RGB')


def compose(raw: Path, title: str, sub: str, out: Path, dark: bool, fold: float | None = None):
    """Same size as the raw screenshot (iPhone, iPad or iPhone Duo); type and margins scale with the width."""
    shot = Image.open(raw).convert('RGB')
    if fold:
        shot = mark_fold(shot, fold, 'Fold')
    w, h = shot.size
    k = min(w, h) / 1206 * (1 if h >= w else 0.8)  # landscape (iPhone Duo inner display): scale by height
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
    """compose-screens.py <raw> <out> [--fold 0.5 --fold-raw <dir> --fold-names chart,trend,map,log]
    With --fold, the named screens come from --fold-raw (half-open iPhone Duo) and get the fold line."""
    args = sys.argv[1:]
    raw, out = Path(args[0]), Path(args[1])
    opt = dict(zip(args[2::2], args[3::2]))
    fold = float(opt['--fold']) if '--fold' in opt else None
    fold_raw = Path(opt.get('--fold-raw', raw))
    fold_names = set(opt.get('--fold-names', '').split(',')) if fold else set()
    out.mkdir(parents=True, exist_ok=True)
    for i, (name, title, sub) in enumerate(ORDER, 1):
        use_fold = name in fold_names
        src = (fold_raw if use_fold else raw) / f'{name}.png'
        if not src.exists():
            print('missing', name)
            continue
        dark = name in ('files', 'viewer', 'stats', 'chart', 'log')
        if use_fold and name == 'chart':
            sub = 'Code and chart meet at the fold'
        compose(src, title, sub, out / f'{i}-{name}.png', dark, fold if use_fold else None)
        print('saved', i, name, '(fold)' if use_fold else '')


if __name__ == '__main__':
    main()
