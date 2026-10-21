/**
 * Waits for the template fonts (declared with @font-face in globals.css, the same files the print
 * PDFs embed) so canvas measuring and drawing never fall back to another font.
 */
import { allFontFiles, FONT_FAMILY_NAMES } from '@printing/templates';

let loading: Promise<void> | null = null;

/** Resolves once every template font can be used; safe to call many times. */
export function loadTemplateFonts(): Promise<void> {
  loading ??= Promise.all(
    allFontFiles().map((font) => document.fonts.load(`${font.weight} 16px "${FONT_FAMILY_NAMES[font.family]}"`)),
  ).then(() => undefined);
  return loading;
}
