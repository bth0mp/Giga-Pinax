#!/usr/bin/env python3
"""Render extension/icons/icon-{16,32,48,128}.png from the geometry of extension/icon.svg with Pillow (a development tool only).

The icon is drawn at 1024 px with the SVG's own numbers (a 128-unit viewBox, scaled by 8) and downsampled with LANCZOS, so the PNGs
match the SVG; below 48 px the lintel, columns and price line are drawn heavier (same axes and end points) so they survive at 16 and 32 px.
Usage: python scripts/make_icons.py [--check]. --check writes nothing and exits 1 when a committed PNG differs from a fresh render.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ICON_DIRECTORY = Path(__file__).resolve().parents[1] / "extension" / "icons"
SIZES = (16, 32, 48, 128)
CANVAS = 1024  # 8 x the 128-unit viewBox
TILE = "#6B1F5C"
IVORY = "#F1E7D8"
GOLD = "#E8BE5A"
LINE = ((22, 92), (44, 78), (62, 86), (84, 60), (106, 66))

# Master geometry (icon.svg) for 48 and 128 px; a heavier cut for 16 and 32 px, with the same axes and end points.
MASTER = {"lintel": (28, 30, 72, 12), "columns": ((36, 42, 12, 54), (80, 42, 12, 54)), "stroke": 7}
SMALL = {"lintel": (28, 29, 72, 14), "columns": ((34, 42, 16, 54), (78, 42, 16, 54)), "stroke": 10}


def render(size: int) -> Image.Image:
    geometry = MASTER if size >= 48 else SMALL
    scale = CANVAS / 128
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def box(x: float, y: float, width: float, height: float) -> tuple[float, float, float, float]:
        return (x * scale, y * scale, (x + width) * scale, (y + height) * scale)

    draw.rounded_rectangle(box(0, 0, 128, 128), radius=28 * scale, fill=TILE)
    draw.rounded_rectangle(box(*geometry["lintel"]), radius=3 * scale, fill=IVORY)
    for column in geometry["columns"]:
        draw.rectangle(box(*column), fill=IVORY)
    stroke = geometry["stroke"] * scale
    points = [(x * scale, y * scale) for x, y in LINE]
    draw.line(points, fill=GOLD, width=round(stroke), joint="curve")
    for x, y in (points[0], points[-1]):  # round caps
        draw.ellipse((x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2), fill=GOLD)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def matches(path: Path, fresh: Image.Image) -> bool:
    if not path.is_file():
        return False
    with Image.open(path) as committed:
        return committed.mode == "RGBA" and committed.size == fresh.size and ImageChops.difference(committed, fresh).getbbox() is None


def main(arguments: list[str]) -> int:
    check = arguments == ["--check"]
    if arguments and not check:
        print("usage: make_icons.py [--check]", file=sys.stderr)
        return 2
    if not check:
        ICON_DIRECTORY.mkdir(parents=True, exist_ok=True)
    stale = []
    for size in SIZES:
        target = ICON_DIRECTORY / f"icon-{size}.png"
        fresh = render(size)
        if check:
            if not matches(target, fresh):
                stale.append(target.name)
        else:
            fresh.save(target, format="PNG", optimize=True)
            print(f"extension/icons/{target.name}")
    if stale:
        print(f"stale: {', '.join(stale)} (run python scripts/make_icons.py)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
