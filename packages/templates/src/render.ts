/**
 * Renders one face of a template to an SVG string. Pure TypeScript (no DOM), so the same code
 * runs in the browser (3D preview, thumbnails) and later on the server (print-ready PDF).
 * SVG user units are points (1in = 72pt).
 */
import type { FaceLayout, ImageElement, RectElement, TemplateLayout, TextElement } from './layout.js';

export const POINTS_PER_INCH = 72;

export interface CardGeometry {
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  safeIn: number;
}

export interface FontSpec {
  family: 'sans' | 'serif';
  weight: number;
  /** Points. */
  size: number;
}

/** Returns the advance width of `text` in points (letter spacing excluded). */
export type MeasureText = (text: string, font: FontSpec) => number;

export interface RenderOptions {
  layout: TemplateLayout;
  side: 'front' | 'back';
  /** Field values by key. Images are data: URLs. */
  values: Record<string, string | undefined>;
  geometry: CardGeometry;
  /** 'trim' for previews, 'bleed' for print files. */
  area?: 'trim' | 'bleed';
  /** Use each field's sample text when the value is empty (previews). Default true. */
  useSamples?: boolean;
  /** Text measurer; the browser passes a canvas-based one. Defaults to an approximation. */
  measure?: MeasureText;
}

export interface RenderWarning {
  field: string;
  issue: 'text-too-long';
}

export interface RenderResult {
  svg: string;
  widthPt: number;
  heightPt: number;
  warnings: RenderWarning[];
}

export const FONT_STACKS: Record<FontSpec['family'], string> = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
};

/** Rough advance widths (in em) for when no real measurer is available. */
export const approximateMeasure: MeasureText = (text, font) => {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if ('il.,:;|!\'`'.includes(ch)) em += 0.28;
    else if ('mwMW@'.includes(ch)) em += 0.85;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else em += 0.54;
  }
  return em * font.size * (font.weight >= 600 ? 1.06 : 1);
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxes(g: CardGeometry): Record<'bleed' | 'trim' | 'safe', Box> {
  const W = g.widthIn * POINTS_PER_INCH;
  const H = g.heightIn * POINTS_PER_INCH;
  const b = g.bleedIn * POINTS_PER_INCH;
  const s = g.safeIn * POINTS_PER_INCH;
  return {
    bleed: { x: 0, y: 0, w: W + 2 * b, h: H + 2 * b },
    trim: { x: b, y: b, w: W, h: H },
    safe: { x: b + s, y: b + s, w: W - 2 * s, h: H - 2 * s },
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const n = (value: number) => Number(value.toFixed(3));

function renderRect(el: RectElement, box: Box): string {
  return `<rect x="${n(box.x + el.x * box.w)}" y="${n(box.y + el.y * box.h)}" width="${n(el.width * box.w)}" height="${n(
    el.height * box.h,
  )}" rx="${n(el.radius)}" fill="${el.fill}"/>`;
}

function renderText(
  el: TextElement,
  box: Box,
  text: string,
  measure: MeasureText,
  warnings: RenderWarning[],
): string {
  const content = el.uppercase ? text.toUpperCase() : text;
  const maxWidth = el.maxWidth * box.w;
  const widthAt = (size: number) =>
    measure(content, { family: el.font, weight: el.weight, size }) + Math.max(0, content.length - 1) * el.letterSpacing * size;

  let size = el.size;
  const natural = widthAt(size);
  if (natural > maxWidth) {
    size = Math.max(el.minSize, (size * maxWidth) / natural);
    if (widthAt(size) > maxWidth + 0.01) warnings.push({ field: el.field, issue: 'text-too-long' });
  }

  const anchor = el.align === 'start' ? 'start' : el.align === 'middle' ? 'middle' : 'end';
  const spacing = el.letterSpacing ? ` letter-spacing="${n(el.letterSpacing * size)}"` : '';
  return `<text x="${n(box.x + el.x * box.w)}" y="${n(box.y + el.y * box.h)}" font-family="${escapeXml(
    FONT_STACKS[el.font],
  )}" font-size="${n(size)}" font-weight="${el.weight}" fill="${el.color}" text-anchor="${anchor}"${spacing}>${escapeXml(
    content,
  )}</text>`;
}

function renderImage(el: ImageElement, box: Box, href: string | undefined): string {
  const x = box.x + el.x * box.w;
  const y = box.y + el.y * box.h;
  const w = el.width * box.w;
  const h = el.height * box.h;
  if (href) {
    const ax = el.align === 'start' ? 'xMin' : el.align === 'end' ? 'xMax' : 'xMid';
    return `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="${ax}YMid meet" href="${escapeXml(
      href,
    )}"/>`;
  }
  // Placeholder: dashed square frame with "LOGO", aligned like the image would be.
  const side = Math.min(w, h);
  const px = el.align === 'start' ? x : el.align === 'end' ? x + w - side : x + (w - side) / 2;
  const py = y + (h - side) / 2;
  return (
    `<rect x="${n(px)}" y="${n(py)}" width="${n(side)}" height="${n(side)}" rx="${n(side * 0.12)}" fill="none" stroke="${el.placeholderColor}" stroke-width="${n(
      Math.max(0.5, side * 0.03),
    )}" stroke-dasharray="${n(side * 0.08)} ${n(side * 0.06)}"/>` +
    `<text x="${n(px + side / 2)}" y="${n(py + side / 2 + side * 0.07)}" font-family="${escapeXml(FONT_STACKS.sans)}" font-size="${n(
      side * 0.2,
    )}" font-weight="700" fill="${el.placeholderColor}" text-anchor="middle" letter-spacing="${n(side * 0.02)}">LOGO</text>`
  );
}

function valueFor(
  layout: TemplateLayout,
  key: string,
  values: RenderOptions['values'],
  useSamples: boolean,
): string | undefined {
  const value = values[key]?.trim();
  if (value) return value;
  return useSamples ? layout.fields.find((f) => f.key === key)?.sample : undefined;
}

export function renderFace(options: RenderOptions): RenderResult {
  const { layout, side, values, geometry } = options;
  const area = options.area ?? 'trim';
  const useSamples = options.useSamples ?? true;
  const measure = options.measure ?? approximateMeasure;
  const face: FaceLayout = layout[side];
  const b = boxes(geometry);
  const view = area === 'bleed' ? b.bleed : b.trim;
  const warnings: RenderWarning[] = [];

  const parts: string[] = [
    `<rect x="0" y="0" width="${n(b.bleed.w)}" height="${n(b.bleed.h)}" fill="${face.background}"/>`,
  ];
  for (const el of face.elements) {
    const box = b[el.box];
    if (el.type === 'rect') parts.push(renderRect(el, box));
    else if (el.type === 'text') {
      const text = valueFor(layout, el.field, values, useSamples);
      if (text) parts.push(renderText(el, box, text, measure, warnings));
    } else {
      const href = values[el.field]?.trim() || undefined;
      if (href || useSamples) parts.push(renderImage(el, box, href));
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}" ` +
    `width="${n(view.w)}pt" height="${n(view.h)}pt">${parts.join('')}</svg>`;
  return { svg, widthPt: view.w, heightPt: view.h, warnings };
}

/** Fields the customer fills for the given printed side mode. */
export function fieldsFor(layout: TemplateLayout, back: 'separate' | 'blank' | 'same_as_front') {
  return layout.fields.filter((f) => f.side !== 'back' || back === 'separate');
}
