/** Browser text measurer for template layout (canvas measureText with the template fonts). */
import { FONT_STACKS, type MeasureText } from '@printing/templates';

let context: CanvasRenderingContext2D | null = null;

export const canvasMeasure: MeasureText = (text, font) => {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * font.size * 0.55;
  // 1 canvas px == 1 point because we measure at the font size in points.
  context.font = `${font.weight} ${font.size}px ${FONT_STACKS[font.family]}`;
  // Plain advance widths, like the PDF painter draws (pdf-lib does not apply kerning).
  context.fontKerning = 'none';
  return context.measureText(text).width;
};
