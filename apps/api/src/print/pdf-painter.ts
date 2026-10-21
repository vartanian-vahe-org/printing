/**
 * Draws a template scene (from layoutFace) on a PDF page: the print-file twin of the storefront's
 * canvas painter. One page per card side, page = bleed box, TrimBox/BleedBox set for prepress.
 */
import { textLeft, textWidth, type FaceScene, type FontFamily, type SceneItem } from '@printing/templates';
import { rgb, setCharacterSpacing, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { fontBytes, fontMeasure } from './print-fonts.js';

function color(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Rounded rectangle as an SVG path in local coordinates (y down), for page.drawSvgPath. */
function roundedRectPath(w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h / 2);
  const k = r * 0.5523; // Bézier approximation of a quarter circle
  return [
    `M ${r} 0 H ${w - r}`,
    `C ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `V ${h - r}`,
    `C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `H ${r}`,
    `C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `V ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0 Z`,
  ].join(' ');
}

export class PdfPainter {
  private readonly fonts = new Map<string, Promise<PDFFont>>();

  /** `images`: embedded PNGs by the href the scene uses (the storage key of the logo). */
  constructor(
    private readonly doc: PDFDocument,
    private readonly images: Map<string, PDFImage>,
  ) {}

  private font(family: FontFamily, weight: number): Promise<PDFFont> {
    const key = `${family}-${weight}`;
    let font = this.fonts.get(key);
    if (!font) {
      // Whole font, not a subset: pdf-lib's subsetting drops glyphs from Inter (letters went
      // missing in tests). Costs ~0.3 MB per weight in the file, fine for print files.
      font = this.doc.embedFont(fontBytes(family, weight), { subset: false });
      this.fonts.set(key, font);
    }
    return font;
  }

  async addPage(scene: FaceScene): Promise<PDFPage> {
    const { view, trim } = scene;
    const page = this.doc.addPage([view.w, view.h]);
    // PDF origin is bottom-left; the scene's is the top-left of the bleed box.
    const px = (x: number) => x - view.x;
    const py = (y: number) => view.h - (y - view.y);
    page.setBleedBox(0, 0, view.w, view.h);
    page.setTrimBox(px(trim.x), py(trim.y + trim.h), trim.w, trim.h);

    page.drawRectangle({ x: 0, y: 0, width: view.w, height: view.h, color: color(scene.background) });
    for (const item of scene.items) await this.draw(page, item, px, py);
    return page;
  }

  private async draw(page: PDFPage, item: SceneItem, px: (x: number) => number, py: (y: number) => number) {
    switch (item.kind) {
      case 'rect':
        if (item.radius > 0) page.drawSvgPath(roundedRectPath(item.w, item.h, item.radius), { x: px(item.x), y: py(item.y), color: color(item.fill), borderWidth: 0 });
        else page.drawRectangle({ x: px(item.x), y: py(item.y + item.h), width: item.w, height: item.h, color: color(item.fill) });
        return;
      case 'text': {
        const font = await this.font(item.font.family, item.font.weight);
        const left = textLeft(item, textWidth(item, fontMeasure));
        if (item.letterSpacing) page.pushOperators(setCharacterSpacing(item.letterSpacing));
        page.drawText(item.text, { x: px(left), y: py(item.y), size: item.font.size, font, color: color(item.color) });
        if (item.letterSpacing) page.pushOperators(setCharacterSpacing(0));
        return;
      }
      case 'image': {
        const image = this.images.get(item.href);
        if (!image) return;
        // "meet": fit inside the frame, keep proportions, align horizontally, center vertically.
        const scale = Math.min(item.w / image.width, item.h / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        const x = item.align === 'start' ? item.x : item.align === 'end' ? item.x + item.w - w : item.x + (item.w - w) / 2;
        const top = item.y + (item.h - h) / 2;
        page.drawImage(image, { x: px(x), y: py(top + h), width: w, height: h });
        return;
      }
      case 'placeholder':
        // Previews only; print scenes never contain placeholders.
        return;
    }
  }
}
