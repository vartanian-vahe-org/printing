"""Proof images (docs/specs/business-card-mvp.md section 6.4): each printed side rendered from the
print file, with the bleed area shaded, the cut line and the safe zone drawn on top."""

from __future__ import annotations

import io

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

from .preflight import PT_PER_IN, Geometry

#: Long side of a proof image in pixels: sharp on a phone, light enough for email links.
PROOF_LONG_SIDE_PX = 1500
CUT_COLOR = (225, 29, 72, 255)  # red
SAFE_COLOR = (37, 99, 235, 255)  # blue
BLEED_SHADE = (255, 255, 255, 120)
#: Under every guide line: keeps the guides visible on dark designs too.
HALO = (255, 255, 255, 230)


def _dashed_rect(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], color, width: int, dash: int):
    left, top, right, bottom = box
    for x0, y0, x1, y1 in ((left, top, right, top), (right, top, right, bottom), (left, bottom, right, bottom), (left, top, left, bottom)):
        length = max(abs(x1 - x0), abs(y1 - y0))
        steps = int(length // (dash * 2)) + 1
        for i in range(steps):
            start = i * dash * 2
            end = min(start + dash, length)
            if x0 == x1:
                draw.line((x0, y0 + start, x1, y0 + end), fill=color, width=width)
            else:
                draw.line((x0 + start, y0, x0 + end, y1), fill=color, width=width)


def render_proofs(data: bytes, geometry: Geometry, pages: int) -> list[bytes]:
    """PNG bytes for the first `pages` pages. Guides assume the page is the card plus bleed;
    for a wrong-size page they are centered, which shows how it would be cut."""
    doc = pdfium.PdfDocument(data)
    images: list[bytes] = []
    try:
        for index in range(min(pages, len(doc))):
            page = doc[index]
            width_pt, height_pt = page.get_size()
            scale = PROOF_LONG_SIDE_PX / max(width_pt, height_pt)
            image = page.render(scale=scale).to_pil().convert("RGBA")

            trim_w, trim_h = geometry.width_in * PT_PER_IN * scale, geometry.height_in * PT_PER_IN * scale
            left, top = (image.width - trim_w) / 2, (image.height - trim_h) / 2
            trim = (left, top, left + trim_w, top + trim_h)
            inset = geometry.safe_in * PT_PER_IN * scale
            safe = (trim[0] + inset, trim[1] + inset, trim[2] - inset, trim[3] - inset)

            overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            # Shade everything outside the cut line: that part is trimmed off.
            draw.rectangle((0, 0, image.width, trim[1]), fill=BLEED_SHADE)
            draw.rectangle((0, trim[3], image.width, image.height), fill=BLEED_SHADE)
            draw.rectangle((0, trim[1], trim[0], trim[3]), fill=BLEED_SHADE)
            draw.rectangle((trim[2], trim[1], image.width, trim[3]), fill=BLEED_SHADE)
            draw.rectangle((trim[0] - 1, trim[1] - 1, trim[2] + 1, trim[3] + 1), outline=HALO, width=5)
            draw.rectangle(trim, outline=CUT_COLOR, width=3)
            _dashed_rect(draw, safe, HALO, 5, 12)
            _dashed_rect(draw, safe, SAFE_COLOR, 2, 12)

            out = io.BytesIO()
            Image.alpha_composite(image, overlay).convert("RGB").save(out, format="PNG", optimize=True)
            images.append(out.getvalue())
    finally:
        doc.close()
    return images
