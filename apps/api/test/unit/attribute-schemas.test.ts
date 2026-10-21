import { describe, expect, it } from 'vitest';
import { attributeSchema } from '../../src/admin/catalog/attribute-schemas.js';

const ok = (group: string, value: string, attrs: unknown) => attributeSchema(group, value).safeParse(attrs).success;

describe('attributeSchema', () => {
  it('accepts the seeded attributes', () => {
    expect(ok('size', 'std_3_5x2', { trim_w_in: 3.5, trim_h_in: 2, bleed_in: 0.125, safe_in: 0.125, price_multiplier: 1 })).toBe(true);
    expect(
      ok('size', 'custom', {
        min_in: 2, max_in: 4, step_in: 0.25, bleed_in: 0.125, safe_in: 0.125,
        fit_box: { w_in: 3.5, h_in: 2 }, fit_multiplier: 1.25, area_multiplier: 0.283,
      }),
    ).toBe(true);
    expect(ok('paper', '14pt', { thickness_pt: 14, tier: 'standard' })).toBe(true);
    expect(ok('coating', 'uv_both', { front: 'uv', back: 'uv', laminated: false })).toBe(true);
    expect(ok('printed_side', 'front_only', { back: 'blank' })).toBe(true);
    expect(ok('corners', 'rounded_quarter', { radius_in: 0.25 })).toBe(true);
    expect(ok('turnaround', '1d', { business_days: 1 })).toBe(true);
  });

  it('rejects wrong types, unknown finishes, extra keys and impossible ranges', () => {
    expect(ok('paper', '14pt', { thickness_pt: 'thick', tier: 'standard' })).toBe(false);
    expect(ok('coating', 'x', { front: 'chrome', back: 'uv', laminated: false })).toBe(false);
    expect(ok('corners', 'x', { radius_in: 0.25, color: 'red' })).toBe(false);
    expect(ok('turnaround', 'x', { business_days: 1.5 })).toBe(false);
    expect(
      ok('size', 'custom', {
        min_in: 4, max_in: 2, step_in: 0.25, bleed_in: 0.125, safe_in: 0.125,
        fit_box: { w_in: 3.5, h_in: 2 }, fit_multiplier: 1.25, area_multiplier: 0.283,
      }),
    ).toBe(false);
  });

  it('accepts any object for groups without a schema', () => {
    expect(ok('foil', 'gold', { anything: true })).toBe(true);
  });
});
