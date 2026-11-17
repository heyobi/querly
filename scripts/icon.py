# Draws the app icon (1024x1024, no alpha) and the splash image, then copies them into the iOS project.
# Usage: python scripts/icon.py
from PIL import Image, ImageDraw, ImageFilter
import shutil

S = 1024
img = Image.new('RGB', (S, S))
d = ImageDraw.Draw(img)
for y in range(S):  # diagonal-ish gradient: deep teal -> indigo
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(8 + 30 * t), int(70 - 35 * t), int(90 + 60 * t)))
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([170, 140, 860, 830], fill=(45, 212, 191, 80))
glow = glow.filter(ImageFilter.GaussianBlur(110))
img.paste(glow, (0, 0), glow)
d = ImageDraw.Draw(img)

cx, cy, r, w = 480, 470, 300, 78
# the "Q" ring
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), width=w)
# tail
d.line([(cx + 170, cy + 170), (cx + 360, cy + 360)], fill=(255, 255, 255), width=w + 8)
d.ellipse([cx + 360 - (w + 8) / 2, cy + 360 - (w + 8) / 2, cx + 360 + (w + 8) / 2, cy + 360 + (w + 8) / 2], fill=(255, 255, 255))
# columns inside the ring (a tiny bar chart)
bars = [(cx - 135, 120, (94, 234, 212)), (cx - 30, 210, (125, 211, 252)), (cx + 75, 160, (253, 224, 71))]
base = cy + 125
for x, hgt, col in bars:
    d.rounded_rectangle([x, base - hgt, x + 72, base], radius=16, fill=col)
img.save('assets/icon-1024.png')

sp = Image.new('RGB', (2732, 2732), (11, 11, 15))
small = img.resize((360, 360), Image.LANCZOS)
m = Image.new('L', (360, 360), 0)
ImageDraw.Draw(m).rounded_rectangle([0, 0, 359, 359], radius=80, fill=255)
sp.paste(small, (1186, 1186), m)
sp.save('assets/splash-2732.png')

shutil.copy('assets/icon-1024.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
for n in ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']:
    shutil.copy('assets/splash-2732.png', f'ios/App/App/Assets.xcassets/Splash.imageset/{n}')
print('icon ok')
