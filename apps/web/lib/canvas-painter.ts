/**
 * Draws a template scene (from layoutFace) on a canvas with the template fonts, for the 3D preview
 * and thumbnails. The PDF painter in the API draws the same scene for print.
 */
import { FONT_STACKS, textLeft, textWidth, type FaceScene, type MeasureText, type SceneItem } from '@printing/templates';
import { canvasMeasure } from './browser-measure';
import { loadTemplateFonts } from './template-fonts';

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(href: string): Promise<HTMLImageElement | null> {
  let promise = images.get(href);
  if (!promise) {
    promise = new Promise((resolve) => {
      const image = new Image();
      // Storage links (logos in the cart) are cross-origin; CORS keeps the canvas exportable.
      if (!href.startsWith('data:')) image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = href;
    });
    images.set(href, promise);
    // Logos are data: URLs that change as customers try files; keep the cache small.
    if (images.size > 20) images.delete(images.keys().next().value!);
  }
  return promise;
}

function drawText(ctx: CanvasRenderingContext2D, item: Extract<SceneItem, { kind: 'text' }>, measure: MeasureText) {
  ctx.font = `${item.font.weight} ${item.font.size}px ${FONT_STACKS[item.font.family]}`;
  ctx.fillStyle = item.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fontKerning = 'none';
  const left = textLeft(item, textWidth(item, measure));
  if (!item.letterSpacing) {
    ctx.fillText(item.text, left, item.y);
    return;
  }
  // Letter spacing: character by character, advancing like the layout measured it.
  let x = left;
  for (const ch of item.text) {
    ctx.fillText(ch, x, item.y);
    x += measure(ch, item.font) + item.letterSpacing;
  }
}

function drawImage(ctx: CanvasRenderingContext2D, item: Extract<SceneItem, { kind: 'image' }>, image: HTMLImageElement) {
  // "meet": fit inside the frame, keep proportions, align horizontally, center vertically.
  const scale = Math.min(item.w / image.naturalWidth, item.h / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  const x = item.align === 'start' ? item.x : item.align === 'end' ? item.x + item.w - w : item.x + (item.w - w) / 2;
  ctx.drawImage(image, x, item.y + (item.h - h) / 2, w, h);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, item: Extract<SceneItem, { kind: 'placeholder' }>) {
  const { x, y, size, color } = item;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, size * 0.03);
  ctx.setLineDash([size * 0.08, size * 0.06]);
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.12);
  ctx.stroke();
  ctx.restore();
  ctx.font = `700 ${size * 0.2}px ${FONT_STACKS.sans}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText('LOGO', x + size / 2, y + size / 2 + size * 0.07);
}

/** Paints the scene's visible area at `pxPerPt` pixels per point. */
export async function paintScene(scene: FaceScene, pxPerPt: number, measure: MeasureText = canvasMeasure): Promise<HTMLCanvasElement> {
  // Without the template fonts the browser would silently draw a fallback font.
  await loadTemplateFonts().catch(() => undefined);
  const loaded = await Promise.all(scene.items.map((item) => (item.kind === 'image' ? loadImage(item.href) : null)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(scene.view.w * pxPerPt);
  canvas.height = Math.round(scene.view.h * pxPerPt);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(pxPerPt, pxPerPt);
  ctx.translate(-scene.view.x, -scene.view.y);
  ctx.fillStyle = scene.background;
  ctx.fillRect(scene.bleed.x, scene.bleed.y, scene.bleed.w, scene.bleed.h);

  scene.items.forEach((item, i) => {
    switch (item.kind) {
      case 'rect':
        ctx.fillStyle = item.fill;
        ctx.beginPath();
        ctx.roundRect(item.x, item.y, item.w, item.h, item.radius);
        ctx.fill();
        break;
      case 'text':
        drawText(ctx, item, measure);
        break;
      case 'image': {
        const image = loaded[i];
        if (image) drawImage(ctx, item, image);
        break;
      }
      case 'placeholder':
        drawPlaceholder(ctx, item);
        break;
    }
  });
  return canvas;
}

/** PNG data URL of the scene, for <img> thumbnails and the 3D card textures. */
export async function sceneToPng(scene: FaceScene, pxPerPt: number): Promise<string> {
  return (await paintScene(scene, pxPerPt)).toDataURL('image/png');
}
