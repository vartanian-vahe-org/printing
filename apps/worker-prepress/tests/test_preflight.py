"""Preflight and proof checks on PDFs built in the test (pikepdf), no storage or queue."""

import io
import zlib

import pikepdf
import pytest
from PIL import Image

from worker.preflight import Geometry, check_pdf
from worker.proof import render_proofs

CARD = Geometry(width_in=3.5, height_in=2.0, bleed_in=0.125, safe_in=0.125)
BLEED = (270, 162)  # (3.5 + 0.25) x (2 + 0.25) in, in points
TRIM = (252, 144)


def make_pdf(pages: list[dict]) -> bytes:
    """pages: [{size, content (bytes), fonts {name: dict}, images {name: (w_px, h_px, colorspace)}}]"""
    pdf = pikepdf.new()
    for spec in pages:
        width, height = spec.get("size", BLEED)
        page = pdf.add_blank_page(page_size=(width, height))
        resources = pikepdf.Dictionary()
        fonts = pikepdf.Dictionary()
        for name, font in spec.get("fonts", {}).items():
            fonts[f"/{name}"] = pdf.make_indirect(pikepdf.Dictionary(font))
        if fonts:
            resources["/Font"] = fonts
        images = pikepdf.Dictionary()
        for name, (w, h, space) in spec.get("images", {}).items():
            channels = 3 if space == "/DeviceRGB" else 4 if space == "/DeviceCMYK" else 1
            stream = pikepdf.Stream(pdf, zlib.compress(bytes(w * h * channels)))
            stream["/Type"] = pikepdf.Name("/XObject")
            stream["/Subtype"] = pikepdf.Name("/Image")
            stream["/Width"], stream["/Height"], stream["/BitsPerComponent"] = w, h, 8
            stream["/ColorSpace"] = pikepdf.Name(space)
            stream["/Filter"] = pikepdf.Name("/FlateDecode")
            images[f"/{name}"] = stream
        if images:
            resources["/XObject"] = images
        page.obj["/Resources"] = resources
        page.obj["/Contents"] = pdf.make_stream(spec.get("content", b""))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def codes(issues):
    return sorted((i.code, i.level) for i in issues)


HELVETICA = {"/Type": pikepdf.Name("/Font"), "/Subtype": pikepdf.Name("/Type1"), "/BaseFont": pikepdf.Name("/Helvetica")}


def test_clean_cmyk_file_passes():
    content = b"0 0 0 1 k 20 20 100 50 re f"
    assert check_pdf(make_pdf([{"content": content}] * 2), CARD, expected_pages=2) == []


def test_size_errors_and_missing_bleed():
    assert codes(check_pdf(make_pdf([{"size": TRIM}]), CARD, expected_pages=1)) == [("no-bleed", "warning")]
    assert codes(check_pdf(make_pdf([{"size": (162, 270)}]), CARD, expected_pages=1)) == [("rotated", "error")]
    issues = check_pdf(make_pdf([{"size": (612, 792)}]), CARD, expected_pages=1)
    assert codes(issues) == [("wrong-size", "error")]
    assert "8.5 × 11 in" in issues[0].message and "3.75 × 2.25 in" in issues[0].message


def test_page_count_must_match_printed_sides():
    assert ("page-count", "error") in codes(check_pdf(make_pdf([{}]), CARD, expected_pages=2))


def test_unembedded_font_is_an_error():
    content = b"BT /F1 10 Tf 40 80 Td (Jamie) Tj ET"
    issues = check_pdf(make_pdf([{"content": content, "fonts": {"F1": HELVETICA}}]), CARD, expected_pages=1)
    assert ("font-not-embedded", "error") in codes(issues)
    assert "Helvetica" in next(i for i in issues if i.code == "font-not-embedded").message


def test_text_near_the_edge_is_a_warning():
    # x = 5pt is inside the bleed, far outside the safe zone (18pt from the page edge).
    content = b"BT /F1 10 Tf 5 80 Td (Edge) Tj ET"
    issues = check_pdf(make_pdf([{"content": content, "fonts": {"F1": HELVETICA}}]), CARD, expected_pages=1)
    assert ("outside-safe-zone", "warning") in codes(issues)


def test_hairlines_and_rgb_are_warnings():
    content = b"0.1 w 1 0 0 RG 20 20 m 200 20 l S"
    issues = check_pdf(make_pdf([{"content": content}]), CARD, expected_pages=1)
    assert codes(issues) == [("hairline", "warning"), ("rgb", "warning")]
    assert codes(check_pdf(make_pdf([{"content": content}]), CARD, expected_pages=1, check_rgb=False)) == [("hairline", "warning")]


def test_line_width_follows_save_and_restore():
    content = b"q 0.1 w Q 20 20 m 200 20 l S"
    assert check_pdf(make_pdf([{"content": content}]), CARD, expected_pages=1, check_rgb=False) == []


@pytest.mark.parametrize("pixels,expect_warning", [(300, True), (1200, False)])
def test_image_resolution(pixels, expect_warning):
    # Image placed at 2 x 1 in: 300 px wide = 150 DPI, 1200 px = 600 DPI.
    content = b"q 144 0 0 72 50 40 cm /Im1 Do Q"
    pdf = make_pdf([{"content": content, "images": {"Im1": (pixels, pixels // 2, "/DeviceCMYK")}}])
    found = ("low-resolution", "warning") in codes(check_pdf(pdf, CARD, expected_pages=1))
    assert found is expect_warning


def test_unreadable_file():
    assert codes(check_pdf(b"not a pdf", CARD, expected_pages=1)) == [("unreadable", "error")]


def test_proof_images_have_the_page_proportions():
    pngs = render_proofs(make_pdf([{"content": b"0 0 1 0 k 0 0 270 162 re f"}] * 2), CARD, pages=2)
    assert len(pngs) == 2
    image = Image.open(io.BytesIO(pngs[0]))
    assert image.width == 1500 and abs(image.height - 900) <= 1
    # Corner is in the shaded bleed area (lighter than the cyan fill), the center is not shaded.
    corner, center = image.getpixel((2, 2)), image.getpixel((750, 450))
    assert sum(corner) > sum(center)


def test_safe_line_stays_visible_on_a_dark_design():
    dark = make_pdf([{"content": b"0 0 0 1 k 0 0 270 162 re f"}])
    image = Image.open(io.BytesIO(render_proofs(dark, CARD, pages=1)[0]))
    # Safe line runs 18pt in from the page edge: 1500 / 270 * 18 = 100 px. Along it (dashes and gaps),
    # the white halo shows on both sides of the blue.
    near_line = [image.getpixel((x, y)) for y in range(400, 500) for x in range(94, 107)]
    assert any(sum(p) > 600 for p in near_line)
    assert any(p == (37, 99, 235) for p in near_line)
