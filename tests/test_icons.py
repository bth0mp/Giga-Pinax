import importlib.util
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"
SVG = ROOT / "scripts" / "icon.svg"
SCRIPT = ROOT / "scripts" / "make_icons.py"
SIZES = (16, 32, 48, 128)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_header(path: Path) -> tuple[int, int, int, int]:
    data = path.read_bytes()
    assert data[:8] == PNG_SIGNATURE, path
    assert data[12:16] == b"IHDR", path
    width, height, bit_depth, colour_type = struct.unpack(">IIBB", data[16:26])
    return width, height, bit_depth, colour_type


class IconFileTests(unittest.TestCase):
    def test_the_four_pngs_are_square_8_bit_rgba_at_their_sizes(self) -> None:
        for size in SIZES:
            with self.subTest(size=size):
                self.assertEqual((size, size, 8, 6), png_header(ICONS / f"icon-{size}.png"))

    def test_the_master_svg_is_the_porphyry_pinax(self) -> None:
        svg = SVG.read_text(encoding="utf-8")
        self.assertIn('viewBox="0 0 128 128"', svg)
        self.assertIn('rx="28" fill="#6B1F5C"', svg)
        self.assertEqual(3, svg.count('fill="#F1E7D8"'))
        self.assertIn('stroke="#E8BE5A" stroke-width="7"', svg)
        self.assertIn('d="M22 92 44 78 62 86 84 60 106 66"', svg)
        self.assertNotIn("#244c5a", svg.lower())


@unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is not installed (development tool only)")
class IconRenderTests(unittest.TestCase):
    def test_committed_pngs_match_a_fresh_render_and_the_svg_colours(self) -> None:
        spec = importlib.util.spec_from_file_location("giga_pinax_make_icons", SCRIPT)
        make_icons = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(make_icons)
        svg = SVG.read_text(encoding="utf-8")
        for colour in (make_icons.TILE, make_icons.IVORY, make_icons.GOLD):
            self.assertIn(colour, svg)
        for size in SIZES:
            with self.subTest(size=size):
                fresh = make_icons.render(size)
                self.assertEqual("RGBA", fresh.mode)
                self.assertEqual((0, 0, 0, 0), fresh.getpixel((0, 0)))
                self.assertTrue(make_icons.matches(ICONS / f"icon-{size}.png", fresh))


if __name__ == "__main__":
    unittest.main()
