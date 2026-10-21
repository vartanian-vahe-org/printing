/**
 * Canvas textures for the 3D preview. Browser-only.
 * Placeholder artwork is used until the customer fills a template (step 7) or uploads a PDF (step 8).
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { CardSpec } from '../../lib/card3d';

const PX_PER_INCH = 300;

function canvasFor(spec: CardSpec): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(spec.widthIn * PX_PER_INCH);
  canvas.height = Math.round(spec.heightIn * PX_PER_INCH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

function toTexture(canvas: HTMLCanvasElement, maxAnisotropy: number): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Draws text, shrinking the font until it fits maxWidth (narrow and portrait cards). */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight: number, size: number, maxWidth: number) {
  let fontSize = size;
  ctx.font = `${weight} ${fontSize}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && fontSize > 6) {
    fontSize *= 0.92;
    ctx.font = `${weight} ${fontSize}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

/** Sample front design, laid out inside the safe zone. */
export function placeholderFront(spec: CardSpec, maxAnisotropy: number): Texture {
  const { canvas, ctx, w, h } = canvasFor(spec);
  const unit = Math.min(w, h);
  const pad = 0.125 * PX_PER_INCH + unit * 0.08;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1f5eff';
  ctx.fillRect(pad, pad, unit * 0.12, unit * 0.12);

  const maxWidth = w - pad * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1c1c1e';
  fitText(ctx, 'Your Name', pad, h - pad - unit * 0.3, 700, unit * 0.12, maxWidth);

  ctx.fillStyle = '#5b5b60';
  fitText(ctx, 'Job Title · Company', pad, h - pad - unit * 0.19, 400, unit * 0.065, maxWidth);
  fitText(ctx, '(555) 010-0100 · you@company.com', pad, h - pad - unit * 0.08, 400, unit * 0.065, maxWidth);

  return toTexture(canvas, maxAnisotropy);
}

/** Sample back design: centered company mark. */
export function placeholderBack(spec: CardSpec, maxAnisotropy: number): Texture {
  const { canvas, ctx, w, h } = canvasFor(spec);
  const unit = Math.min(w, h);

  ctx.fillStyle = '#1f5eff';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxWidth = w * 0.8;
  fitText(ctx, 'COMPANY', w / 2, h / 2 - unit * 0.04, 700, unit * 0.13, maxWidth);
  ctx.globalAlpha = 0.85;
  fitText(ctx, 'Your tagline here', w / 2, h / 2 + unit * 0.1, 400, unit * 0.06, maxWidth);

  return toTexture(canvas, maxAnisotropy);
}

/** Plain paper for an unprinted back. */
export function blankFace(spec: CardSpec, maxAnisotropy: number): Texture {
  const { canvas, ctx, w, h } = canvasFor(spec);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return toTexture(canvas, maxAnisotropy);
}

/** Fine random grain used as a bump map for uncoated paper. */
export function paperGrain(spec: CardSpec): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 110 + Math.random() * 40;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(spec.widthIn * 3, spec.heightIn * 3);
  return texture;
}
