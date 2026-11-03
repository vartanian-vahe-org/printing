"""Automatic file checks for print files (docs/specs/business-card-mvp.md section 6.3).

Pure functions: PDF bytes in, a list of issues out. "error" blocks the file (the customer uploads a
new one); "warning" must be acknowledged by the customer before approving.

Customer and designer files are checked strictly: images of at least 300 DPI, CMYK or grayscale
colors only (no RGB, no spot colors) and embedded fonts. Template files are drawn by us in CMYK, so
only the checks that can still go wrong there run on them (size, fonts, a low-resolution logo).
"""

from __future__ import annotations

import ctypes
import io
import math
from dataclasses import asdict, dataclass

import pikepdf
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

PT_PER_IN = 72.0
#: Page size tolerance: about 1/72 in, absorbs rounding in design tools.
SIZE_TOLERANCE_PT = 1.0
MIN_DPI = 300
#: Design tools round sizes, so an image placed at "300 DPI" can measure 299.x.
DPI_TOLERANCE = 0.99
HAIRLINE_PT = 0.25
MIN_TEXT_PT = 6.0
STROKE_OPS = {"S", "s", "B", "B*", "b", "b*"}
SIDE_NAMES = {1: "Front", 2: "Back"}
#: Separation / DeviceN colorant names that are process inks (or all of them), not spot colors.
PROCESS_COLORANTS = {"/Cyan", "/Magenta", "/Yellow", "/Black", "/All", "/None"}


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


def check_size(page_no: int, side: str, size: tuple[float, float], geometry: Geometry) -> list[Issue]:
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
    """Yields a page's resource dictionaries, including those of nested form XObjects and patterns."""
    if resources is None:
        return
    seen = seen if seen is not None else set()
    yield resources
    for group in ("/XObject", "/Pattern"):
        children = resources.get(group)
        if children is None:
            continue
        for _, child in children.items():
            key = child.objgen
            is_form = group == "/XObject" and child.get("/Subtype") == "/Form"
            is_tiling = group == "/Pattern" and child.get("/PatternType") == 1
            if key in seen or not (is_form or is_tiling):
                continue
            seen.add(key)
            yield from _resources_tree(child.get("/Resources"), seen)


def _font_embedded(font: pikepdf.Dictionary) -> bool:
    subtype = font.get("/Subtype")
    if subtype == "/Type3":
        return True  # glyphs are drawn by the PDF itself
    if subtype == "/Type0":
        descendants = font.get("/DescendantFonts")
        font = descendants[0] if descendants else font
    descriptor = font.get("/FontDescriptor")
    return descriptor is not None and any(k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3"))


def check_fonts(page_no: int, side: str, page: pikepdf.Page) -> list[Issue]:
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


def color_kind(space) -> str:
    """'cmyk', 'gray', 'rgb' (RGB or Lab: screen colors), 'spot' or 'other' (patterns, unknown)."""
    if isinstance(space, pikepdf.Name):
        return {
            "/DeviceCMYK": "cmyk",
            "/DeviceGray": "gray",
            "/CalGray": "gray",
            "/DeviceRGB": "rgb",
            "/CalRGB": "rgb",
            "/Lab": "rgb",
        }.get(str(space), "other")
    if isinstance(space, pikepdf.Array) and len(space) > 0:
        family = str(space[0])
        if family == "/ICCBased":
            return {1: "gray", 3: "rgb", 4: "cmyk"}.get(int(space[1].get("/N", 0)), "other")
        if family in ("/CalRGB", "/Lab"):
            return "rgb"
        if family == "/CalGray":
            return "gray"
        if family == "/Indexed" or (family == "/Pattern" and len(space) > 1):
            return color_kind(space[1])
        if family == "/Separation":
            return "cmyk" if str(space[1]) in PROCESS_COLORANTS else "spot"
        if family == "/DeviceN":
            return "cmyk" if all(str(name) in PROCESS_COLORANTS for name in space[1]) else "spot"
    return "other"


def _color_spaces(page: pikepdf.Page):
    """Every color space the page defines or uses: named spaces, images, shadings and shading patterns."""
    for resources in _resources_tree(page.obj.get("/Resources")):
        spaces = resources.get("/ColorSpace")
        for _, space in spaces.items() if spaces is not None else []:
            yield space
        xobjects = resources.get("/XObject")
        for _, xobject in xobjects.items() if xobjects is not None else []:
            if xobject.get("/Subtype") == "/Image" and not xobject.get("/ImageMask", False) and "/ColorSpace" in xobject:
                yield xobject.get("/ColorSpace")
        shadings = resources.get("/Shading")
        for _, shading in shadings.items() if shadings is not None else []:
            if "/ColorSpace" in shading:
                yield shading.get("/ColorSpace")
        patterns = resources.get("/Pattern")
        for _, pattern in patterns.items() if patterns is not None else []:
            shading = pattern.get("/Shading")
            if shading is not None and "/ColorSpace" in shading:
                yield shading.get("/ColorSpace")


def check_strokes_and_color(page_no: int, side: str, page: pikepdf.Page, strict: bool) -> list[Issue]:
    issues: list[Issue] = []
    widths = [1.0]  # graphics state stack, PDF default line width is 1
    hairline = False
    kinds: set[str] = set()
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
            kinds.add("rgb")
    if hairline:
        issues.append(
            Issue("hairline", "warning", f"{side}: some lines are thinner than 0.25 pt and may not print or may print unevenly.", page_no)
        )
    if not strict:
        return issues
    kinds.update(color_kind(space) for space in _color_spaces(page))
    if "rgb" in kinds:
        issues.append(
            Issue(
                "rgb",
                "error",
                f"{side}: the file uses RGB colors. We print in CMYK only: convert the design to CMYK and export it again.",
                page_no,
            )
        )
    if "spot" in kinds:
        issues.append(
            Issue(
                "spot-color",
                "error",
                f"{side}: the file uses spot (Pantone) colors. Convert them to CMYK process colors and export it again.",
                page_no,
            )
        )
    return issues


def _font_size(obj: pdfium.PdfObject) -> float | None:
    """Rendered size of a text object in points (font size × the object's scale)."""
    size = ctypes.c_float()
    if not pdfium_c.FPDFTextObj_GetFontSize(obj.raw, ctypes.byref(size)):
        return None
    m = obj.get_matrix()
    return size.value * math.sqrt(abs(m.a * m.d - m.b * m.c))


def check_images_and_text(page_no: int, side: str, page: pdfium.PdfPage, geometry: Geometry, size_ok: bool, strict: bool) -> list[Issue]:
    issues: list[Issue] = []
    lowest_dpi: float | None = None
    for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=15):
        left, bottom, right, top = obj.get_bounds()
        width_in, height_in = (right - left) / PT_PER_IN, (top - bottom) / PT_PER_IN
        if width_in < 0.1 or height_in < 0.1:
            continue  # tiny marks, not worth checking
        px_w, px_h = obj.get_px_size()
        dpi = min(px_w / width_in, px_h / height_in)
        lowest_dpi = dpi if lowest_dpi is None else min(lowest_dpi, dpi)
    if lowest_dpi is not None and lowest_dpi < MIN_DPI * DPI_TOLERANCE:
        issues.append(
            Issue(
                "low-resolution",
                "error" if strict else "warning",
                f"{side}: an image is {round(lowest_dpi)} DPI; it must be at least {MIN_DPI} DPI to print sharp."
                + (" Use a higher-resolution image and export again." if strict else " It may look blurry."),
                page_no,
            )
        )

    texts = list(page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_TEXT,), max_depth=15))
    if strict:
        sizes = [s for s in (_font_size(obj) for obj in texts) if s is not None and s > 0]
        if sizes and min(sizes) < MIN_TEXT_PT - 0.05:
            issues.append(
                Issue(
                    "small-text",
                    "warning",
                    f"{side}: some text is {min(sizes):.1f} pt; text smaller than {MIN_TEXT_PT:g} pt is hard to read on a printed card.",
                    page_no,
                )
            )

    if size_ok:
        # Safe zone in page coordinates (origin bottom-left, page = card + bleed).
        inset = (geometry.bleed_in + geometry.safe_in) * PT_PER_IN
        width, height = page.get_size()
        safe = (inset, inset, width - inset, height - inset)
        for obj in texts:
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

    if strict:
        # A page with nothing on it is usually the wrong file or an empty back.
        thumbnail = page.render(scale=0.25).to_pil().convert("L")
        if thumbnail.getextrema()[0] >= 250:
            issues.append(Issue("blank-page", "warning", f"{side} looks blank. Check that you uploaded the right file.", page_no))
    return issues


def check_pdf(
    data: bytes,
    geometry: Geometry,
    *,
    expected_pages: int | None,
    strict: bool = True,
    max_pages: int = 2,
    side_names: dict[int, str] | None = None,
) -> list[Issue]:
    """All checks for one print file (one page per printed side). `expected_pages` None checks the
    first `max_pages` pages there are, without a page-count rule; `side_names` labels them in messages."""
    names = side_names or SIDE_NAMES
    try:
        doc = pikepdf.open(io.BytesIO(data))
    except pikepdf.PasswordError:
        return [Issue("encrypted", "error", "The PDF is protected with a password. Export it again without a password.")]
    except pikepdf.PdfError:
        return [Issue("unreadable", "error", "The file could not be read as a PDF. Export it again and upload the new file.")]

    issues: list[Issue] = []
    with doc:
        if expected_pages is not None and len(doc.pages) != expected_pages:
            issues.append(
                Issue("page-count", "error", f"The print file has {len(doc.pages)} page(s); this order needs {expected_pages}.")
            )
        rendered = pdfium.PdfDocument(data)
        try:
            for index, page in enumerate(doc.pages[: expected_pages if expected_pages is not None else max_pages]):
                page_no = index + 1
                side = names.get(page_no, f"Page {page_no}")
                size_issues = check_size(page_no, side, _page_size(page), geometry)
                issues += size_issues
                issues += check_fonts(page_no, side, page)
                issues += check_strokes_and_color(page_no, side, page, strict)
                issues += check_images_and_text(page_no, side, rendered[index], geometry, not size_issues, strict)
        finally:
            rendered.close()
    return issues
