/**
 * Fonts used by templates (open issue U8): Inter (sans) and Lora (serif), both SIL Open Font
 * License, from the @expo-google-fonts npm packages. The storefront preview (canvas) and the
 * print file (PDF) load these same files, so text measures and shrinks the same in both.
 */
import { FONT_COVERAGE } from './font-coverage.js';

export type FontFamily = 'sans' | 'serif';

export const FONT_FAMILY_NAMES: Record<FontFamily, string> = { sans: 'Inter', serif: 'Lora' };

/** npm package holding each family's .ttf files. */
export const FONT_PACKAGES: Record<FontFamily, string> = {
  sans: '@expo-google-fonts/inter',
  serif: '@expo-google-fonts/lora',
};

/** Available weights → file path inside the package. */
export const FONT_FILES: Record<FontFamily, Record<number, string>> = {
  sans: {
    400: '400Regular/Inter_400Regular.ttf',
    500: '500Medium/Inter_500Medium.ttf',
    600: '600SemiBold/Inter_600SemiBold.ttf',
    700: '700Bold/Inter_700Bold.ttf',
    800: '800ExtraBold/Inter_800ExtraBold.ttf',
  },
  serif: {
    400: '400Regular/Lora_400Regular.ttf',
    500: '500Medium/Lora_500Medium.ttf',
    600: '600SemiBold/Lora_600SemiBold.ttf',
    700: '700Bold/Lora_700Bold.ttf',
  },
};

/** Closest available weight (ties go to the bolder one), so every renderer uses the same file. */
export function availableWeight(family: FontFamily, weight: number): number {
  const weights = Object.keys(FONT_FILES[family]).map(Number);
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) || (Math.abs(w - weight) === Math.abs(best - weight) && w > best) ? w : best));
}

/** Every font file the templates may use, e.g. to copy them next to the storefront. */
export function allFontFiles(): { family: FontFamily; weight: number; packageName: string; path: string; fileName: string }[] {
  return (Object.keys(FONT_FILES) as FontFamily[]).flatMap((family) =>
    Object.entries(FONT_FILES[family]).map(([weight, path]) => ({
      family,
      weight: Number(weight),
      packageName: FONT_PACKAGES[family],
      path,
      fileName: path.split('/').pop()!,
    })),
  );
}


function covered(family: FontFamily, codePoint: number): boolean {
  const ranges = FONT_COVERAGE[family];
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid]!;
    if (codePoint < start) hi = mid - 1;
    else if (codePoint > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Characters of `text` the family's font cannot draw (emoji, most non-Latin scripts), each once. */
export function unsupportedCharacters(text: string, family: FontFamily): string[] {
  const missing = new Set<string>();
  for (const ch of text) if (!covered(family, ch.codePointAt(0)!)) missing.add(ch);
  return [...missing];
}

/** Font families a field is drawn in (a field can appear on both sides in different styles). */
export function fieldFamilies(layout: { front: { elements: { type: string; field?: string; font?: FontFamily }[] }; back: { elements: { type: string; field?: string; font?: FontFamily }[] } }, field: string): FontFamily[] {
  const families = new Set<FontFamily>();
  for (const el of [...layout.front.elements, ...layout.back.elements]) {
    if (el.type === 'text' && el.field === field) families.add(el.font ?? 'sans');
  }
  return [...families];
}
