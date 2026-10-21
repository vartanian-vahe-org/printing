import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { availableWeight, FONT_FILES, FONT_PACKAGES, type FontFamily, type MeasureText } from '@printing/templates';

/** Template font files (Inter, Lora) read from their npm packages, the same files the storefront serves. */
const bytesCache = new Map<string, Uint8Array>();
const fontCache = new Map<string, fontkit.Font>();

export function fontBytes(family: FontFamily, weight: number): Uint8Array {
  const w = availableWeight(family, weight);
  const key = `${family}-${w}`;
  let bytes = bytesCache.get(key);
  if (!bytes) {
    const packageDir = dirname(require.resolve(`${FONT_PACKAGES[family]}/package.json`));
    bytes = new Uint8Array(readFileSync(join(packageDir, FONT_FILES[family][w]!)));
    bytesCache.set(key, bytes);
  }
  return bytes;
}

function font(family: FontFamily, weight: number): fontkit.Font {
  const key = `${family}-${availableWeight(family, weight)}`;
  let f = fontCache.get(key);
  if (!f) {
    f = fontkit.create(fontBytes(family, weight));
    fontCache.set(key, f);
  }
  return f;
}

/**
 * Text width from the font file: sum of glyph advances, exactly what pdf-lib draws (no kerning).
 * The storefront measures the same way (canvas with kerning off).
 */
export const fontMeasure: MeasureText = (text, spec) => {
  const f = font(spec.family, spec.weight);
  const advance = f.layout(text).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0);
  return (advance / f.unitsPerEm) * spec.size;
};

export { fontkit };
