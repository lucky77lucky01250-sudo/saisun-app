#!/usr/bin/env python3
"""ホーム画面用アイコンを生成する。

文字は入れない（CJKフォントの有無で見た目が変わるため）。
メジャーの目盛りだけで「採寸」を表す。
    python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw

EMERALD = (16, 185, 129)
WHITE = (255, 255, 255)
OUT = [("public/icon-192.png", 192), ("public/icon-512.png", 512), ("app/apple-icon.png", 180)]
SS = 4  # 4倍で描いて縮小し、縁を滑らかにする


def draw(size: int) -> Image.Image:
    s = size * SS
    img = Image.new("RGB", (s, s), EMERALD)
    d = ImageDraw.Draw(img)

    # メジャーの帯
    band_h = int(s * 0.34)
    top = (s - band_h) // 2
    margin = int(s * 0.12)
    d.rounded_rectangle(
        [margin, top, s - margin, top + band_h],
        radius=int(s * 0.03),
        fill=WHITE,
    )

    # 目盛り（長短を交互に。中央だけさらに長くして基準線に見せる）
    tick_w = max(1, int(s * 0.018))
    inner_w = (s - margin * 2)
    n = 9
    for i in range(1, n):
        x = margin + inner_w * i // n
        if i == n // 2:
            h = int(band_h * 0.62)
        elif i % 2 == 0:
            h = int(band_h * 0.42)
        else:
            h = int(band_h * 0.24)
        d.rectangle([x - tick_w // 2, top, x + tick_w // 2, top + h], fill=EMERALD)

    return img.resize((size, size), Image.LANCZOS)


for path, size in OUT:
    draw(size).save(path)
    print(f"生成: {path} ({size}x{size})")
