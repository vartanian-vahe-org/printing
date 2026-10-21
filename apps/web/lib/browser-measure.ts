/** Browser text measurer for the template renderer (canvas measureText, same font stacks as the SVG). */
import { FONT_STACKS, type MeasureText } from '@printing/templates';

let context: CanvasRenderingContext2D | null = null;

export const canvasMeasure: MeasureText = (text, font) => {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * font.size * 0.55;
  // 1 canvas px == 1 SVG unit (pt) because we measure at the font size in points.
  context.font = `${font.weight} ${font.size}px ${FONT_STACKS[font.family]}`;
  return context.measureText(text).width;
};
