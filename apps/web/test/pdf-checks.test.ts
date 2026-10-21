import { describe, expect, it } from 'vitest';
import { checkFile, checkPages, checkPageSize, worstLevel } from '../lib/pdf-checks.js';

const std = { widthIn: 3.5, heightIn: 2, bleedIn: 0.125 };

describe('checkFile', () => {
  it('accepts a PDF up to 50 MB', () => {
    expect(checkFile({ name: 'card.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
    expect(checkFile({ name: 'CARD.PDF', type: '', size: 1000 })).toBeNull();
  });

  it('rejects other types, empty and oversized files', () => {
    expect(checkFile({ name: 'card.png', type: 'image/png', size: 1000 })?.level).toBe('error');
    expect(checkFile({ name: 'card.pdf', type: 'application/pdf', size: 0 })?.message).toMatch(/empty/);
    expect(checkFile({ name: 'card.pdf', type: 'application/pdf', size: 51 * 1024 * 1024 })?.message).toMatch(/50 MB/);
  });
});

describe('checkPageSize', () => {
  it('accepts the bleed size (3.75" x 2.25")', () => {
    expect(checkPageSize({ widthPt: 270, heightPt: 162 }, std)).toMatchObject({ level: 'ok', hasBleed: true });
  });

  it('tolerates tiny rounding differences', () => {
    expect(checkPageSize({ widthPt: 271.2, heightPt: 161.1 }, std).level).toBe('ok');
  });

  it('warns when the page is trim size (no bleed)', () => {
    const result = checkPageSize({ widthPt: 252, heightPt: 144 }, std);
    expect(result).toMatchObject({ level: 'warning', hasBleed: false });
    expect(result.message).toContain('3.75" × 2.25"');
  });

  it('rejects the other orientation with a hint', () => {
    const result = checkPageSize({ widthPt: 162, heightPt: 270 }, std);
    expect(result.level).toBe('error');
    expect(result.message).toMatch(/other orientation.*portrait/);
  });

  it('rejects a wrong size and says what to upload', () => {
    const result = checkPageSize({ widthPt: 612, heightPt: 792 }, std);
    expect(result.level).toBe('error');
    expect(result.message).toBe(
      'Your page is 8.5" × 11". For a 3.5" × 2" card, upload 3.75" × 2.25" (with bleed) or 3.5" × 2".',
    );
  });

  it('works for square and custom sizes', () => {
    expect(checkPageSize({ widthPt: 198, heightPt: 198 }, { widthIn: 2.5, heightIn: 2.5, bleedIn: 0.125 }).level).toBe('ok');
    expect(checkPageSize({ widthPt: 162, heightPt: 306 }, { widthIn: 2, heightIn: 4, bleedIn: 0.125 }).level).toBe('ok');
  });
});

describe('checkPages', () => {
  it('uses page 2 as the back when there is no back file', () => {
    expect(checkPages(2, null, 'separate')).toEqual([{ level: 'info', message: 'Page 2 of your file is used as the back.' }]);
  });

  it('requires a back for front-and-back printing', () => {
    expect(worstLevel(checkPages(1, null, 'separate'))).toBe('error');
    expect(checkPages(1, 1, 'separate')).toEqual([]);
  });

  it('warns that extra pages are not printed with a blank back', () => {
    expect(checkPages(2, null, 'blank')[0]?.level).toBe('warning');
    expect(checkPages(1, null, 'blank')).toEqual([]);
  });

  it('notes ignored pages', () => {
    expect(checkPages(4, null, 'separate').map((r) => r.message)).toContain('Pages 3–4 are not used.');
    expect(checkPages(2, 3, 'separate').map((r) => r.message)).toEqual([
      'Only page 1 of the front file is used.',
      'Only page 1 of the back file is used.',
    ]);
  });
});
