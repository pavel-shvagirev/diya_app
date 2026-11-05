#!/usr/bin/env python3
"""Derive the application and tray icons from the supplied icon pack.

Input:  assets/icon-pack/ios/AppIcon-1024.png (the master, a dark rounded square on a pale
        background).
Output: assets/icon.png           512 px, same padded artwork: the window icon (Windows, Linux) and the
                                  Dock icon of a development run on macOS
        build/icon.png            1024 px, transparent corners and the standard margin (electron-builder makes the
                                  macOS .icns, the Windows .ico and the Linux icons from it)
        build/icons/NxN.png       16 … 512 px, the Linux icon set (deb, rpm, AppImage): a theme looks up
                                  only the standard sizes, so a lone 1024 px file shows as a gear
        assets/tray-icon.png      16 px  } the tray icon; Electron picks @2x on HiDPI screens
        assets/tray-icon@2x.png   32 px  }
Needs Pillow and NumPy: pip install pillow numpy
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/icon-pack/ios/AppIcon-1024.png"
SS = 4  # supersampling for a smooth corner mask

master = Image.open(SRC).convert("RGB")
pixels = np.asarray(master).astype(int)
ys, xs = np.where(pixels.sum(axis=2) < 330)  # the dark rounded square
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = min(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
crop = master.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side))

radius = round(side * 0.115)
mask = Image.new("L", (side * SS, side * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, side * SS - 1, side * SS - 1), radius * SS, fill=255)
mask = mask.resize((side, side), Image.LANCZOS)
icon = crop.convert("RGBA")
icon.putalpha(mask)

def save(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(path.relative_to(ROOT), size)


def padded(img: Image.Image, canvas: int = 1024, body: int = 824) -> Image.Image:
    """The artwork on a transparent canvas with the margin Apple's icon grid asks for (the body is
    824 of 1024 px); without it the Dock shows the icon larger than its neighbours."""
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    inner = img.resize((body, body), Image.LANCZOS)
    out.paste(inner, ((canvas - body) // 2, (canvas - body) // 2), inner)
    return out

app_icon = padded(icon)
save(app_icon, ROOT / "build/icon.png", 1024)
save(app_icon, ROOT / "assets/icon.png", 512)
save(icon, ROOT / "assets/tray-icon.png", 16)
save(icon, ROOT / "assets/tray-icon@2x.png", 32)
for px in (16, 24, 32, 48, 64, 128, 256, 512):
    save(app_icon, ROOT / f"build/icons/{px}x{px}.png", px)
