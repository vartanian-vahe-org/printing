/**
 * Basic checks for an uploaded print PDF (Phase 1 step 8). Full preflight (resolution,
 * fonts, color space, safe zone) runs on the server later (spec §6.3).
 */
import type { BackMode } from './card3d';
import { formatInches } from './format';

export const PDF_MAX_BYTES = 50 * 1024 * 1024;
/** Allowed difference between the page size and the expected size (~0.03"). */
const TOLERANCE_PT = 2;
const PT = 72;

export type CheckLevel = 'ok' | 'info' | 'warning' | 'error';

export interface CheckResult {
  level: CheckLevel;
  message: string;
}

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export interface ExpectedSize {
  widthIn: number;
  heightIn: number;
  bleedIn: number;
}

export interface PageSizeCheck extends CheckResult {
  /** The page includes bleed, so the preview should crop it to the trim line. */
  hasBleed: boolean;
}

const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_PT;
const matches = (page: PageSize, w: number, h: number) => close(page.widthPt, w) && close(page.heightPt, h);
const inches = (pt: number) => formatInches(Math.round((pt / PT) * 100) / 100);

export function checkFile(file: { name: string; type: string; size: number }): CheckResult | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return { level: 'error', message: 'Please upload a PDF file.' };
  if (file.size > PDF_MAX_BYTES) return { level: 'error', message: 'The file must be 50 MB or smaller.' };
  if (file.size === 0) return { level: 'error', message: 'This file is empty.' };
  return null;
}

export function checkPageSize(page: PageSize, size: ExpectedSize): PageSizeCheck {
  const trimW = size.widthIn * PT;
  const trimH = size.heightIn * PT;
  const bleedW = (size.widthIn + 2 * size.bleedIn) * PT;
  const bleedH = (size.heightIn + 2 * size.bleedIn) * PT;
  const want = `${formatInches(size.widthIn + 2 * size.bleedIn)} × ${formatInches(size.heightIn + 2 * size.bleedIn)}`;
  const actual = `${inches(page.widthPt)} × ${inches(page.heightPt)}`;

  if (matches(page, bleedW, bleedH)) {
    return { level: 'ok', hasBleed: true, message: `Page size ${actual} with bleed. Looks good.` };
  }
  if (matches(page, trimW, trimH)) {
    return {
      level: 'warning',
      hasBleed: false,
      message: `Your page is ${actual} with no bleed. A thin white edge may show after trimming. For edge-to-edge color, use ${want}.`,
    };
  }
  if (matches(page, bleedH, bleedW) || matches(page, trimH, trimW)) {
    return {
      level: 'error',
      hasBleed: false,
      message: `Your page is ${actual}, which is the other orientation. Rotate your design or choose a ${
        trimW > trimH ? 'portrait' : 'landscape'
      } custom size.`,
    };
  }
  return {
    level: 'error',
    hasBleed: false,
    message: `Your page is ${actual}. For a ${formatInches(size.widthIn)} × ${formatInches(size.heightIn)} card, upload ${want} (with bleed) or ${formatInches(size.widthIn)} × ${formatInches(size.heightIn)}.`,
  };
}

/**
 * Page count rules: the back comes from a separate back file, or from page 2 of the front file.
 */
export function checkPages(frontPages: number, backFilePages: number | null, backMode: BackMode): CheckResult[] {
  const results: CheckResult[] = [];
  if (backMode === 'separate') {
    if (backFilePages !== null) {
      if (frontPages > 1) results.push({ level: 'info', message: 'Only page 1 of the front file is used.' });
      if (backFilePages > 1) results.push({ level: 'info', message: 'Only page 1 of the back file is used.' });
    } else if (frontPages >= 2) {
      results.push({ level: 'info', message: 'Page 2 of your file is used as the back.' });
      if (frontPages > 2) results.push({ level: 'info', message: `Pages 3–${frontPages} are not used.` });
    } else {
      results.push({ level: 'error', message: 'Add your back design: upload a back file or a 2-page PDF.' });
    }
  } else if (frontPages > 1) {
    results.push({
      level: 'warning',
      message:
        backMode === 'blank'
          ? 'Only page 1 is printed because the back is blank. Choose "Front and Back" to print page 2.'
          : 'Only page 1 is used, on both sides.',
    });
  }
  return results;
}

/** The worst level among results, used for the badge next to each file. */
export function worstLevel(results: CheckResult[]): CheckLevel {
  const order: CheckLevel[] = ['ok', 'info', 'warning', 'error'];
  return results.reduce<CheckLevel>((worst, r) => (order.indexOf(r.level) > order.indexOf(worst) ? r.level : worst), 'ok');
}
