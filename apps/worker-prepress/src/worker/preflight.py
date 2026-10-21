"""Automatic file checks for print files (docs/specs/business-card-mvp.md section 6.3).

Pure functions: PDF bytes in, a list of issues out. "error" blocks the proof (the customer
uploads a new file); "warning" must be acknowledged by the customer before approving.
"""

from __future__ import annotations

import io
from dataclasses import asdict, dataclass

import pikepdf
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

PT_PER_IN = 72.0
#: Page size tolerance: about 1/72 in, absorbs rounding in design tools.
SIZE_TOLERANCE_PT = 1.0
MIN_DPI = 300
HAIRLINE_PT = 0.25
STROKE_OPS = {"S", "s", "B", "B*", "b", "b*"}
SIDE_NAMES = {1: "Front", 2: "Back"}


@dataclass(frozen=True)
class Geometry:
    """Finished card size and margins, in inches (from the order's print spec)."""

    width_in: float
    height_in: float
    bleed_in: float
    safe_in: float

    @property
    def bleed_size_pt(self) -> tuple[float, float]:
        return ((self.width_in + 2 * self.bleed_in) * PT_PER_IN, (self.height_in + 2 * self.bleed_in) * PT_PER_IN)

    @property
    def trim_size_pt(self) -> tuple[float, float]:
        return (self.width_in * PT_PER_IN, self.height_in * PT_PER_IN)

    @classmethod
    def from_job(cls, data: dict) -> Geometry:
        return cls(data["widthIn"], data["heightIn"], data["bleedIn"], data["safeIn"])


@dataclass(frozen=True)
class Issue:
    code: str
    level: str  # "error" | "warning"
    message: str
    page: int | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


def _inches(pt: float) -> str:
    return f"{pt / PT_PER_IN:.3f}".rstrip("0").rstrip(".")


def _close(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return abs(a[0] - b[0]) <= SIZE_TOLERANCE_PT and abs(a[1] - b[1]) <= SIZE_TOLERANCE_PT


def _page_size(page: pikepdf.Page) -> tuple[float, float]:
    """Visible page size in points (crop box, rotation applied)."""
    box = [float(v) for v in page.cropbox]
    width, height = abs(box[2] - box[0]), abs(box[3] - box[1])
    rotate = int(page.obj.get("/Rotate", 0)) % 180
    return (height, width) if rotate == 90 else (width, height)


def check_size(page_no: int, size: tuple[float, float], geometry: Geometry) -> list[Issue]:
    side = SIDE_NAMES.get(page_no, f"Page {page_no}")
    bleed, trim = geometry.bleed_size_pt, geometry.trim_size_pt
    if _close(size, bleed):
        return []
    if _close(size, trim):
        return [
            Issue(
                "no-bleed",
                "warning",
                f"{side}: the page is the finished card size without bleed. Colors or images that touch the edge may show a thin white line after cutting.",
                page_no,
            )
        ]
    if _close(size, (bleed[1], bleed[0])) or _close(size, (trim[1], trim[0])):
        return [Issue("rotated", "error", f"{side}: the page is rotated. Turn it to match the card orientation.", page_no)]
    return [
        Issue(
            "wrong-size",
            "error",
            f"{side}: the page is {_inches(size[0])} × {_inches(size[1])} in; it must be {_inches(bleed[0])} × {_inches(bleed[1])} in "
            f"(the card plus {_inches(geometry.bleed_in * PT_PER_IN)} in bleed on every side).",
            page_no,
        )
    ]


def _resources_tree(resources: pikepdf.Dictionary | None, seen: set[tuple[int, int]] | None = None):
    """Yields a page's resource dictionaries, including those of nested form XObjects."""
    if resources is None:
        return
    seen = seen if seen is not None else set()
    yield resources
    xobjects = resources.get("/XObject")
    if xobjects is None:
        return
    for _, xobject in xobjects.items():
        key = xobject.objgen
        if key in seen or xobject.get("/Subtype") != "/Form":
            continue
        seen.add(key)
        yield from _resources_tree(xobject.get("/Resources"), seen)


def _font_embedded(font: pikepdf.Dictionary) -> bool:
    subtype = font.get("/Subtype")
    if subtype == "/Type3":
        return True  # glyphs are drawn by the PDF itself
    if subtype == "/Type0":
        descendants = font.get("/DescendantFonts")
        font = descendants[0] if descendants else font
    descriptor = font.get("/FontDescriptor")
    return descriptor is not None and any(k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3"))


def check_fonts(page_no: int, page: pikepdf.Page) -> list[Issue]:
    missing: set[str] = set()
    for resources in _resources_tree(page.obj.get("/Resources")):
        fonts = resources.get("/Font")
        if fonts is None:
            continue
        for _, font in fonts.items():
            if not _font_embedded(font):
                missing.add(str(font.get("/BaseFont", "unknown")).lstrip("/"))
    if not missing:
        return []
    side = SIDE_NAMES.get(page_no, f"Page {page_no}")
    names = ", ".join(sorted(missing))
    return [
        Issue(
            "font-not-embedded",
            "error",
            f"{side}: fonts are not embedded ({names}). Export the PDF with fonts embedded, or convert text to outlines.",
            page_no,
        )
    ]


def _content_ops(page: pikepdf.Page):
    """Content stream operators of the page and its form XObjects."""
    yield from pikepdf.parse_content_stream(page)
    for resources in _resources_tree(page.obj.get("/Resources")):
        xobjects = resources.get("/XObject")
        if xobjects is None:
            continue
        for _, xobject in xobjects.items():
            if xobject.get("/Subtype") == "/Form":
                yield from pikepdf.parse_content_stream(xobject)


def check_strokes_and_color(page_no: int, page: pikepdf.Page, check_rgb: bool) -> list[Issue]:
    side = SIDE_NAMES.get(page_no, f"Page {page_no}")
    issues: list[Issue] = []
    widths = [1.0]  # graphics state stack, PDF default line width is 1
    hairline = False
    rgb = False
    for operands, operator in _content_ops(page):
        op = str(operator)
        if op == "q":
            widths.append(widths[-1])
        elif op == "Q" and len(widths) > 1:
            widths.pop()
        elif op == "w" and operands:
            widths[-1] = float(operands[0])
        elif op in STROKE_OPS and widths[-1] < HAIRLINE_PT:
            hairline = True
        elif op in ("rg", "RG"):
            rgb = True
    if hairline:
        issues.append(
            Issue("hairline", "warning", f"{side}: some lines are thinner than 0.25 pt and may not print or may print unevenly.", page_no)
        )
    if check_rgb:
        for resources in _resources_tree(page.obj.get("/Resources")):
            xobjects = resources.get("/XObject")
            for _, xobject in (xobjects.items() if xobjects is not None else []):
                if xobject.get("/Subtype") != "/Image":
                    continue
                space = xobject.get("/ColorSpace")
                if space == "/DeviceRGB" or (isinstance(space, pikepdf.Array) and space[0] == "/ICCBased" and int(space[1].get("/N", 0)) == 3):
                    rgb = True
        if rgb:
            issues.append(
                Issue(
                    "rgb",
                    "warning",
                    f"{side}: the file uses RGB colors. We convert them to print colors (CMYK); bright greens and blues may look slightly duller on paper.",
                    page_no,
                )
            )
    return issues


def check_images_and_text(page_no: int, page: pdfium.PdfPage, geometry: Geometry, size_ok: bool) -> list[Issue]:
    side = SIDE_NAMES.get(page_no, f"Page {page_no}")
    issues: list[Issue] = []
    lowest_dpi: float | None = None
    for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=15):
        left, bottom, right, top = obj.get_bounds()
        width_in, height_in = (right - left) / PT_PER_IN, (top - bottom) / PT_PER_IN
        if width_in < 0.1 or height_in < 0.1:
            continue  # tiny marks, not worth a warning
        px_w, px_h = obj.get_px_size()
        dpi = min(px_w / width_in, px_h / height_in)
        lowest_dpi = dpi if lowest_dpi is None else min(lowest_dpi, dpi)
    if lowest_dpi is not None and lowest_dpi < MIN_DPI - 1:
        issues.append(
            Issue(
                "low-resolution",
                "warning",
                f"{side}: an image is {round(lowest_dpi)} DPI; at least {MIN_DPI} DPI prints sharp. It may look blurry.",
                page_no,
            )
        )

    if size_ok:
        # Safe zone in page coordinates (origin bottom-left, page = card + bleed).
        inset = (geometry.bleed_in + geometry.safe_in) * PT_PER_IN
        width, height = page.get_size()
        safe = (inset, inset, width - inset, height - inset)
        for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_TEXT,), max_depth=15):
            left, bottom, right, top = obj.get_bounds()
            if left < safe[0] - 0.5 or bottom < safe[1] - 0.5 or right > safe[2] + 0.5 or top > safe[3] + 0.5:
                issues.append(
                    Issue(
                        "outside-safe-zone",
                        "warning",
                        f"{side}: some text is closer than {_inches(geometry.safe_in * PT_PER_IN)} in to the edge and may be cut off.",
                        page_no,
                    )
                )
                break
    return issues


def check_pdf(data: bytes, geometry: Geometry, *, expected_pages: int, check_rgb: bool = True) -> list[Issue]:
    """All checks for one print file (one page per printed side)."""
    try:
        doc = pikepdf.open(io.BytesIO(data))
    except pikepdf.PdfError:
        return [Issue("unreadable", "error", "The file could not be read as a PDF. Export it again and upload the new file.")]

    issues: list[Issue] = []
    with doc:
        if len(doc.pages) != expected_pages:
            issues.append(
                Issue("page-count", "error", f"The print file has {len(doc.pages)} page(s); this order needs {expected_pages}.")
            )
        rendered = pdfium.PdfDocument(data)
        try:
            for index, page in enumerate(doc.pages[:expected_pages]):
                page_no = index + 1
                size_issues = check_size(page_no, _page_size(page), geometry)
                issues += size_issues
                issues += check_fonts(page_no, page)
                issues += check_strokes_and_color(page_no, page, check_rgb)
                issues += check_images_and_text(page_no, rendered[index], geometry, size_ok=not size_issues)
        finally:
            rendered.close()
    return issues
