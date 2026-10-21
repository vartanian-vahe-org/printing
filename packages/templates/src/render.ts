/**
 * Template rendering in two steps (decision P12, one renderer for preview and print):
 *   1. layoutFace(): resolves a face to a scene, the exact shapes to draw in points (1in = 72pt),
 *      with text already shrunk to fit. Pure TypeScript, no DOM.
 *   2. A painter draws the scene: sceneToSvg() here, a canvas painter in the storefront and a PDF
 *      painter in the API. Painters do no layout, so they cannot disagree on sizes or positions.
 * Scene coordinates start at the top-left corner of the bleed box; y grows downwards.
 */
import { availableWeight, FONT_FAMILY_NAMES, type FontFamily } from './fonts.js';
import type { FaceLayout, ImageElement, RectElement, TemplateLayout, TextElement } from './layout.js';

export const POINTS_PER_INCH = 72;

export interface CardGeometry {
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  safeIn: number;
}

export interface FontSpec {
  family: FontFamily;
  weight: number;
  /** Points. */
  size: number;
}

/** Returns the advance width of `text` in points (letter spacing excluded). */
export type MeasureText = (text: string, font: FontSpec) => number;

export interface RenderOptions {
  layout: TemplateLayout;
  side: 'front' | 'back';
  /** Field values by key. Images are URLs (data: URLs in the browser). */
  values: Record<string, string | undefined>;
  geometry: CardGeometry;
  /** 'trim' for previews, 'bleed' for print files. */
  area?: 'trim' | 'bleed';
  /** Use each field's sample text when the value is empty (previews). Default true. */
  useSamples?: boolean;
  /** Text measurer with the real fonts (canvas in the browser, font files on the server). */
  measure?: MeasureText;
}

export interface RenderWarning {
  field: string;
  issue: 'text-too-long';
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SceneItem =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; radius: number; fill: string }
  | {
      kind: 'text';
      field: string;
      /** Anchor point: left, center or right end of the text depending on `align`; y is the baseline. */
      x: number;
      y: number;
      align: 'start' | 'middle' | 'end';
      /** Final text (uppercased when the layout asks for it). */
      text: string;
      font: FontSpec;
      color: string;
      /** Extra space after each character but the last, in points. */
      letterSpacing: number;
    }
  | { kind: 'image'; field: string; x: number; y: number; w: number; h: number; align: 'start' | 'middle' | 'end'; href: string }
  | { kind: 'placeholder'; x: number; y: number; size: number; color: string };

export interface FaceScene {
  /** Visible area (trim for previews, bleed for print), in scene coordinates. */
  view: Box;
  /** Full bleed box; the background fills it. */
  bleed: Box;
  trim: Box;
  background: string;
  items: SceneItem[];
  warnings: RenderWarning[];
}

export interface RenderResult {
  svg: string;
  widthPt: number;
  heightPt: number;
  warnings: RenderWarning[];
}

/** CSS font stacks: the template font first, then look-alikes while it loads. */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: `'${FONT_FAMILY_NAMES.sans}', 'Helvetica Neue', Helvetica, Arial, sans-serif`,
  serif: `'${FONT_FAMILY_NAMES.serif}', Georgia, 'Times New Roman', Times, serif`,
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

export function cardBoxes(g: CardGeometry): Record<'bleed' | 'trim' | 'safe', Box> {
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

/** Width of a text item including letter spacing, in points. */
export function textWidth(item: { text: string; font: FontSpec; letterSpacing: number }, measure: MeasureText): number {
  return measure(item.text, item.font) + Math.max(0, [...item.text].length - 1) * item.letterSpacing;
}

/** Left edge of a text item. */
export function textLeft(item: { x: number; align: 'start' | 'middle' | 'end' }, width: number): number {
  return item.align === 'start' ? item.x : item.align === 'middle' ? item.x - width / 2 : item.x - width;
}

function layoutRect(el: RectElement, box: Box): SceneItem {
  return { kind: 'rect', x: box.x + el.x * box.w, y: box.y + el.y * box.h, w: el.width * box.w, h: el.height * box.h, radius: el.radius, fill: el.fill };
}

function layoutText(el: TextElement, box: Box, text: string, measure: MeasureText, warnings: RenderWarning[]): SceneItem {
  const content = el.uppercase ? text.toUpperCase() : text;
  const weight = availableWeight(el.font, el.weight);
  const maxWidth = el.maxWidth * box.w;
  const widthAt = (size: number) =>
    textWidth({ text: content, font: { family: el.font, weight, size }, letterSpacing: el.letterSpacing * size }, measure);

  let size = el.size;
  const natural = widthAt(size);
  if (natural > maxWidth) {
    size = Math.max(el.minSize, (size * maxWidth) / natural);
    if (widthAt(size) > maxWidth + 0.01) warnings.push({ field: el.field, issue: 'text-too-long' });
  }
  return {
    kind: 'text',
    field: el.field,
    x: box.x + el.x * box.w,
    y: box.y + el.y * box.h,
    align: el.align,
    text: content,
    font: { family: el.font, weight, size },
    color: el.color,
    letterSpacing: el.letterSpacing * size,
  };
}

function layoutImage(el: ImageElement, box: Box, href: string | undefined): SceneItem {
  const x = box.x + el.x * box.w;
  const y = box.y + el.y * box.h;
  const w = el.width * box.w;
  const h = el.height * box.h;
  if (href) return { kind: 'image', field: el.field, x, y, w, h, align: el.align, href };
  // Placeholder: dashed square frame with "LOGO", aligned like the image would be.
  const size = Math.min(w, h);
  const px = el.align === 'start' ? x : el.align === 'end' ? x + w - size : x + (w - size) / 2;
  return { kind: 'placeholder', x: px, y: y + (h - size) / 2, size, color: el.placeholderColor };
}

function valueFor(layout: TemplateLayout, key: string, values: RenderOptions['values'], useSamples: boolean): string | undefined {
  const value = values[key]?.trim();
  if (value) return value;
  return useSamples ? layout.fields.find((f) => f.key === key)?.sample : undefined;
}

export function layoutFace(options: RenderOptions): FaceScene {
  const { layout, side, values, geometry } = options;
  const useSamples = options.useSamples ?? true;
  const measure = options.measure ?? approximateMeasure;
  const face: FaceLayout = layout[side];
  const b = cardBoxes(geometry);
  const warnings: RenderWarning[] = [];
  const items: SceneItem[] = [];

  for (const el of face.elements) {
    const box = b[el.box];
    if (el.type === 'rect') items.push(layoutRect(el, box));
    else if (el.type === 'text') {
      const text = valueFor(layout, el.field, values, useSamples);
      if (text) items.push(layoutText(el, box, text, measure, warnings));
    } else {
      const href = values[el.field]?.trim() || undefined;
      if (href || useSamples) items.push(layoutImage(el, box, href));
    }
  }

  return { view: options.area === 'bleed' ? b.bleed : b.trim, bleed: b.bleed, trim: b.trim, background: face.background, items, warnings };
}

// ---------------------------------------------------------------- SVG painter

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const n = (value: number) => Number(value.toFixed(3));

function svgItem(item: SceneItem): string {
  switch (item.kind) {
    case 'rect':
      return `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.w)}" height="${n(item.h)}" rx="${n(item.radius)}" fill="${item.fill}"/>`;
    case 'text': {
      const spacing = item.letterSpacing ? ` letter-spacing="${n(item.letterSpacing)}"` : '';
      return `<text x="${n(item.x)}" y="${n(item.y)}" font-family="${escapeXml(FONT_STACKS[item.font.family])}" font-size="${n(
        item.font.size,
      )}" font-weight="${item.font.weight}" fill="${item.color}" text-anchor="${item.align}"${spacing}>${escapeXml(item.text)}</text>`;
    }
    case 'image': {
      const ax = item.align === 'start' ? 'xMin' : item.align === 'end' ? 'xMax' : 'xMid';
      return `<image x="${n(item.x)}" y="${n(item.y)}" width="${n(item.w)}" height="${n(item.h)}" preserveAspectRatio="${ax}YMid meet" href="${escapeXml(
        item.href,
      )}"/>`;
    }
    case 'placeholder': {
      const { x, y, size, color } = item;
      return (
        `<rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${n(size * 0.12)}" fill="none" stroke="${color}" stroke-width="${n(
          Math.max(0.5, size * 0.03),
        )}" stroke-dasharray="${n(size * 0.08)} ${n(size * 0.06)}"/>` +
        `<text x="${n(x + size / 2)}" y="${n(y + size / 2 + size * 0.07)}" font-family="${escapeXml(FONT_STACKS.sans)}" font-size="${n(
          size * 0.2,
        )}" font-weight="700" fill="${color}" text-anchor="middle" letter-spacing="${n(size * 0.02)}">LOGO</text>`
      );
    }
  }
}

export function sceneToSvg(scene: FaceScene): string {
  const { view, bleed } = scene;
  const parts = [`<rect x="0" y="0" width="${n(bleed.w)}" height="${n(bleed.h)}" fill="${scene.background}"/>`, ...scene.items.map(svgItem)];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}" ` +
    `width="${n(view.w)}pt" height="${n(view.h)}pt">${parts.join('')}</svg>`
  );
}

/** Layout + SVG in one call (thumbnails, tests). */
export function renderFace(options: RenderOptions): RenderResult {
  const scene = layoutFace(options);
  return { svg: sceneToSvg(scene), widthPt: scene.view.w, heightPt: scene.view.h, warnings: scene.warnings };
}

/** Fields the customer fills for the given printed side mode. */
export function fieldsFor(layout: TemplateLayout, back: 'separate' | 'blank' | 'same_as_front') {
  return layout.fields.filter((f) => f.side !== 'back' || back === 'separate');
}
