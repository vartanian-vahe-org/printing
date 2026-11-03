"""Upload formats: detection from the bytes and the print PDF made from each accepted type."""

import io
import struct

import pikepdf
import pytest
from PIL import Image

from worker.formats import detect, normalize, select_pages
from worker.preflight import check_pdf

from test_preflight import CARD, MARK, codes

#: Card plus bleed at 300 DPI: 3.75 x 2.25 in.
FULL = (1125, 675)


def image_bytes(mode: str, size: tuple[int, int], fmt: str) -> bytes:
    out = io.BytesIO()
    color = {"CMYK": (0, 0, 0, 255), "RGB": (10, 20, 30), "L": 0, "LA": (0, 255)}[mode]
    Image.new(mode, size, color).save(out, format=fmt)
    return out.getvalue()


def psd_bytes(size: tuple[int, int]) -> bytes:
    """Smallest valid CMYK Photoshop file: header, empty sections, raw merged image (inverted ink, PSD style)."""
    width, height = size
    header = b"8BPS" + struct.pack(">H6xHIIHH", 1, 4, height, width, 8, 4)
    sections = struct.pack(">III", 0, 0, 0)
    channels = bytes([255]) * (width * height) * 3 + bytes([0]) * (width * height)  # C, M, Y = 0%, K = 100%
    return header + sections + struct.pack(">H", 0) + channels


def check(normalized):
    return codes(normalized.issues + (check_pdf(normalized.pdf, CARD, expected_pages=None) if normalized.pdf else []))


def page_size(pdf: bytes) -> tuple[float, float]:
    with pikepdf.open(io.BytesIO(pdf)) as doc:
        box = [float(v) for v in doc.pages[0].cropbox]
        return (round(box[2] - box[0], 2), round(box[3] - box[1], 2))


def test_detects_the_type_from_the_bytes():
    assert detect(b"%PDF-1.7\n...") == "pdf"
    assert detect(b"%!PS-Adobe-3.0 EPSF-3.0") == "postscript"
    assert detect(image_bytes("CMYK", (10, 10), "JPEG")) == "jpeg"
    assert detect(image_bytes("CMYK", (10, 10), "TIFF")) == "tiff"
    assert detect(image_bytes("RGB", (10, 10), "PNG")) == "png"
    assert detect(psd_bytes((10, 10))) == "psd"
    assert detect(b"PK\x03\x04 a zip") == "unknown"


@pytest.mark.parametrize("fmt", ["JPEG", "TIFF"])
def test_cmyk_image_at_300_dpi_becomes_a_card_size_pdf(fmt):
    normalized = normalize(image_bytes("CMYK", FULL, fmt), CARD)
    assert normalized.pdf is not None
    assert page_size(normalized.pdf) == (270, 162)
    assert check(normalized) == []


def test_cmyk_photoshop_file_is_read():
    normalized = normalize(psd_bytes(FULL), CARD)
    assert normalized.format == "psd"
    assert check(normalized) == []


def test_grayscale_is_accepted_and_transparency_flattened():
    assert check(normalize(image_bytes("L", FULL, "TIFF"), CARD)) == []
    assert check(normalize(image_bytes("LA", FULL, "TIFF"), CARD)) == []


def test_rgb_image_is_refused():
    normalized = normalize(image_bytes("RGB", FULL, "JPEG"), CARD)
    assert normalized.pdf is None
    assert codes(normalized.issues) == [("rgb", "error")]


def test_low_resolution_image_is_refused():
    # Half the pixels: 150 DPI.
    assert ("low-resolution", "error") in check(normalize(image_bytes("CMYK", (562, 337), "JPEG"), CARD))


def test_image_proportions():
    # The finished card size without bleed (3.5 x 2 in at 300 DPI) is accepted with a warning.
    no_bleed = normalize(image_bytes("CMYK", (1050, 600), "TIFF"), CARD)
    assert page_size(no_bleed.pdf) == (252, 144)
    assert check(no_bleed) == [("no-bleed", "warning")]
    assert codes(normalize(image_bytes("CMYK", (675, 1125), "TIFF"), CARD).issues) == [("rotated", "error")]
    wrong = normalize(image_bytes("CMYK", (1000, 1000), "TIFF"), CARD)
    assert codes(wrong.issues) == [("wrong-size", "error")]
    assert "1125 × 675 px" in wrong.issues[0].message


@pytest.mark.parametrize(
    "data,message",
    [
        (image_bytes("RGB", FULL, "PNG"), "PNG files cannot hold CMYK"),
        (b"%!PS-Adobe-3.0 EPSF-3.0\n", "PDF Compatible"),
        (b"PK\x03\x04 a zip", "not accepted"),
    ],
)
def test_unsupported_formats(data, message):
    normalized = normalize(data, CARD)
    assert normalized.pdf is None
    assert codes(normalized.issues) == [("unsupported-format", "error")]
    assert message in normalized.issues[0].message


def test_huge_images_are_refused_before_decoding(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    assert codes(normalize(image_bytes("CMYK", FULL, "TIFF"), CARD).issues) == [("image-too-large", "error")]


def test_crop_marks_are_cut_off_at_the_bleed():
    # Exported with crop marks: a 0.5 in margin around the card plus bleed, trim box on the card.
    pdf = pikepdf.new()
    page = pdf.add_blank_page(page_size=(342, 234))
    page.obj["/TrimBox"] = pikepdf.Array([45, 45, 297, 189])
    page.obj["/Contents"] = pdf.make_stream(MARK.replace(b"20 20", b"60 60"))
    out = io.BytesIO()
    pdf.save(out)
    normalized = normalize(out.getvalue(), CARD)
    assert page_size(normalized.pdf) == (270, 162)
    assert check(normalized) == []


def test_other_pdfs_are_unchanged():
    data = normalize(image_bytes("CMYK", FULL, "JPEG"), CARD).pdf
    assert normalize(data, CARD).pdf == data


def test_chosen_pages_become_front_and_back_in_order():
    pdf = pikepdf.new()
    for width in (270, 271, 272):  # tell the pages apart by width
        pdf.add_blank_page(page_size=(width, 162))
    out = io.BytesIO()
    pdf.save(out)
    chosen, issues = select_pages(out.getvalue(), [3, 1])
    assert issues == []
    with pikepdf.open(io.BytesIO(chosen)) as doc:
        assert [float(p.mediabox[2]) for p in doc.pages] == [272, 270]
    missing, issues = select_pages(out.getvalue(), [1, 4])
    assert missing is None and codes(issues) == [("page-missing", "error")]

