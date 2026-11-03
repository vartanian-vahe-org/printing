"""Customer upload formats: what a file really is (from its bytes, never its name) and the print PDF
made from it, one page per printed side, ready for preflight.

Accepted: PDF, Illustrator (.ai saved with PDF compatibility), JPEG, TIFF and Photoshop (.psd).
Images must be CMYK (or grayscale) and fill the card, so they become a one-page PDF of the card
size with the image at its own resolution. PNG cannot hold CMYK, and EPS / PostScript is not
accepted yet (it needs Ghostscript to read, which is unsafe on untrusted files).
"""

from __future__ import annotations

import io
import zlib
from dataclasses import dataclass, field

import pikepdf
from PIL import Image

from .preflight import MIN_DPI, PT_PER_IN, SIZE_TOLERANCE_PT, Geometry, Issue, _close, _inches

#: Larger images are refused before decoding (a small file can decode to billions of pixels).
MAX_PIXELS = 100_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
#: How far an image's proportions may be from the card's, about one pixel row on a card.
RATIO_TOLERANCE = 0.01


@dataclass
class Normalized:
    """The print PDF made from an upload (None when the file cannot be used) and what was wrong."""

    pdf: bytes | None
    format: str
    issues: list[Issue] = field(default_factory=list)


def detect(data: bytes) -> str:
    """'pdf', 'postscript' (EPS, or Illustrator without PDF compatibility), 'jpeg', 'tiff', 'psd', 'png' or 'unknown'."""
    if b"%PDF-" in data[:1024]:
        return "pdf"
    if data.startswith(b"%!PS") or data.startswith(b"\xc5\xd0\xd3\xc6"):
        return "postscript"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if data.startswith(b"8BPS"):
        return "psd"
    if data.startswith(b"\x89PNG"):
        return "png"
    return "unknown"


def normalize(data: bytes, geometry: Geometry) -> Normalized:
    kind = detect(data)
    if kind == "pdf":
        return Normalized(crop_to_bleed(data, geometry), kind)
    if kind in ("jpeg", "tiff", "psd"):
        return image_to_pdf(data, geometry, kind)
    message = {
        "postscript": "EPS files, and Illustrator files saved without PDF compatibility, are not accepted. "
        "In Illustrator, save with “Create PDF Compatible File” turned on, or export a PDF.",
        "png": "PNG files cannot hold CMYK colors. Export your design as a CMYK PDF, TIFF or JPG.",
    }.get(kind, "This file type is not accepted. Upload a PDF, AI, TIFF, JPG or PSD file.")
    return Normalized(None, kind, [Issue("unsupported-format", "error", message)])


def crop_to_bleed(data: bytes, geometry: Geometry) -> bytes:
    """Files exported with crop marks are bigger than the card; when they declare the card's trim box,
    each page is cut down to that box plus the bleed. Other files are returned unchanged."""
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except pikepdf.PdfError:
        return data  # preflight reports it
    changed = False
    with pdf:
        bleed_pt = geometry.bleed_in * PT_PER_IN
        for page in pdf.pages:
            box = [float(v) for v in page.cropbox]
            size = (abs(box[2] - box[0]), abs(box[3] - box[1]))
            if _close(size, geometry.bleed_size_pt) or _close(size, geometry.trim_size_pt) or "/TrimBox" not in page.obj:
                continue
            trim = [float(v) for v in page.trimbox]
            if not _close((trim[2] - trim[0], trim[3] - trim[1]), geometry.trim_size_pt):
                continue
            media = [float(v) for v in page.mediabox]
            target = [trim[0] - bleed_pt, trim[1] - bleed_pt, trim[2] + bleed_pt, trim[3] + bleed_pt]
            fits = (
                target[0] >= media[0] - SIZE_TOLERANCE_PT
                and target[1] >= media[1] - SIZE_TOLERANCE_PT
                and target[2] <= media[2] + SIZE_TOLERANCE_PT
                and target[3] <= media[3] + SIZE_TOLERANCE_PT
            )
            new_box = pikepdf.Array(target if fits else trim)  # no room for bleed: the card size, flagged as no bleed
            page.obj["/MediaBox"] = new_box
            page.obj["/CropBox"] = new_box
            changed = True
        if not changed:
            return data
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


def _matches(ratio: float, size: tuple[float, float]) -> bool:
    return abs(ratio / (size[0] / size[1]) - 1) <= RATIO_TOLERANCE


def image_to_pdf(data: bytes, geometry: Geometry, kind: str) -> Normalized:
    name = {"jpeg": "JPG", "tiff": "TIFF", "psd": "PSD"}[kind]
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.load()  # the first page of a multi-page TIFF; the merged image of a PSD
            image = source.copy()
    except Image.DecompressionBombError:
        return Normalized(None, kind, [Issue("image-too-large", "error", f"The {name} image is too large to process. Export it at the card size, 300 DPI.")])
    except (OSError, SyntaxError, ValueError):
        hint = " In Photoshop, save with “Maximize Compatibility” turned on, or export a PDF or TIFF." if kind == "psd" else ""
        return Normalized(None, kind, [Issue("unreadable", "error", f"The {name} file could not be read.{hint}")])

    if image.mode == "LA":
        white = Image.new("L", image.size, 255)
        white.paste(image.getchannel("L"), mask=image.getchannel("A"))
        image = white
    elif image.mode in ("1", "I;16", "I;16B", "I;16L", "I"):
        image = image.convert("L")
    if image.mode not in ("CMYK", "L"):
        return Normalized(
            None,
            kind,
            [
                Issue(
                    "rgb",
                    "error",
                    f"The {name} image is in {image.mode} colors. We print in CMYK only: convert the image to CMYK (in Photoshop: "
                    "Image > Mode > CMYK Color) and save it again.",
                )
            ],
        )

    px_w, px_h = image.size
    ratio = px_w / px_h
    bleed_in = (geometry.width_in + 2 * geometry.bleed_in, geometry.height_in + 2 * geometry.bleed_in)
    trim_in = (geometry.width_in, geometry.height_in)
    if _matches(ratio, bleed_in):
        page_in = bleed_in
    elif _matches(ratio, trim_in):
        page_in = trim_in  # preflight flags the missing bleed
    elif _matches(ratio, (bleed_in[1], bleed_in[0])) or _matches(ratio, (trim_in[1], trim_in[0])):
        return Normalized(None, kind, [Issue("rotated", "error", f"The {name} image is rotated. Turn it to match the card orientation.")])
    else:
        min_w, min_h = round(bleed_in[0] * MIN_DPI), round(bleed_in[1] * MIN_DPI)
        return Normalized(
            None,
            kind,
            [
                Issue(
                    "wrong-size",
                    "error",
                    f"The {name} image is {px_w} × {px_h} px, which does not have the proportions of this card. It must be "
                    f"{_inches(bleed_in[0] * PT_PER_IN)} × {_inches(bleed_in[1] * PT_PER_IN)} in (the card plus bleed): "
                    f"{min_w} × {min_h} px at {MIN_DPI} DPI.",
                )
            ],
        )

    page_pt = (page_in[0] * PT_PER_IN, page_in[1] * PT_PER_IN)
    pdf = pikepdf.new()
    xobject = pikepdf.Stream(pdf, zlib.compress(image.tobytes(), 6))
    xobject["/Type"] = pikepdf.Name("/XObject")
    xobject["/Subtype"] = pikepdf.Name("/Image")
    xobject["/Width"], xobject["/Height"], xobject["/BitsPerComponent"] = px_w, px_h, 8
    xobject["/ColorSpace"] = pikepdf.Name("/DeviceCMYK" if image.mode == "CMYK" else "/DeviceGray")
    xobject["/Filter"] = pikepdf.Name("/FlateDecode")
    page = pdf.add_blank_page(page_size=page_pt)
    page.obj["/Resources"] = pikepdf.Dictionary({"/XObject": pikepdf.Dictionary({"/Im0": xobject})})
    page.obj["/Contents"] = pdf.make_stream(f"q {page_pt[0]:.4f} 0 0 {page_pt[1]:.4f} 0 0 cm /Im0 Do Q".encode())
    out = io.BytesIO()
    pdf.save(out)
    return Normalized(out.getvalue(), kind)


def select_pages(pdf: bytes, pages: list[int]) -> tuple[bytes | None, list[Issue]]:
    """The customer's choice of pages from a multi-page file, in print order (front, then back).
    `pages` are 1-based page numbers of the file."""
    try:
        source = pikepdf.open(io.BytesIO(pdf))
    except pikepdf.PdfError:
        return pdf, []  # preflight reports it
    with source:
        missing = [n for n in pages if not 1 <= n <= len(source.pages)]
        if missing:
            return None, [Issue("page-missing", "error", f"The file has {len(source.pages)} page(s); page {missing[0]} does not exist.")]
        chosen = pikepdf.new()
        for number in pages:
            chosen.pages.append(source.pages[number - 1])
        out = io.BytesIO()
        chosen.save(out)
        return out.getvalue(), []

