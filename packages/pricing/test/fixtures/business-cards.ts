/**
 * Mirrors the seeded defaults in packages/db/migrations/0001-0003 (spec docs/specs/business-card-mvp.md).
 * If the seed changes, update this fixture; the API integration test (step 4) checks the real DB.
 */
import type { Catalog, OptionGroup, OptionValue } from '../../src/types.js';

const B = 0.125;

function v(code: string, sortOrder: number, attributes: Record<string, unknown> = {}, isDefault = false): OptionValue {
  return { code, label: code, description: null, sortOrder, isDefault, attributes };
}

function g(code: string, sortOrder: number, values: OptionValue[]): OptionGroup {
  return { code, label: code, sortOrder, displayStyle: 'dropdown', values };
}

const TIERS: [number, number][] = [
  [50, 1000],
  [100, 1499],
  [250, 1999],
  [500, 2499],
  [1000, 3799],
  [2500, 8099],
  [5000, 12799],
  [10000, 22299],
];

const UPCHARGE_PERCENT: [string, string, number][] = [
  ['paper', '16pt', 25],
  ['paper', '17pt_uncoated', 166],
  ['coating', 'gloss_both', 7],
  ['coating', 'uncoated_both', 7],
  ['coating', 'uv_both', 7],
  ['coating', 'uv_front_uncoated_back', 43],
  ['coating', 'uv_front_gloss_back', 43],
  ['coating', 'soft_touch_both', 24],
  ['coating', 'silk_both', 24],
  ['printed_side', 'front_back', 58],
  ['printed_side', 'same_both', 58],
  ['corners', 'rounded_quarter', 47],
  ['turnaround', '5d', -10],
  ['turnaround', '2d', 30],
  ['turnaround', '1d', 80],
];

/** Same rounding as the SQL generator: half away from zero, to the cent. */
function percentOf(base: number, percent: number): number {
  const exact = (base * percent) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

const COATING_14 = ['matte_both', 'gloss_both', 'uncoated_both', 'uv_both', 'uv_front_uncoated_back', 'uv_front_gloss_back'];
const NO_1D = ['5d', '3d', '2d'];

export const businessCards: Catalog = {
  product: { code: 'business-cards', name: 'Business Cards' },
  groups: [
    g('size', 1, [
      v('std_3_5x2', 1, { trim_w_in: 3.5, trim_h_in: 2, bleed_in: B, safe_in: B, price_multiplier: 1 }, true),
      v('square_2_5', 2, { trim_w_in: 2.5, trim_h_in: 2.5, bleed_in: B, safe_in: B, price_multiplier: 1.96 }),
      v('slim_3_5x1_75', 3, { trim_w_in: 3.5, trim_h_in: 1.75, bleed_in: B, safe_in: B, price_multiplier: 1.31 }),
      v('custom', 4, {
        min_in: 2,
        max_in: 4,
        step_in: 0.25,
        bleed_in: B,
        safe_in: B,
        fit_box: { w_in: 3.5, h_in: 2 },
        fit_multiplier: 1.25,
        area_multiplier: 0.283,
      }),
    ]),
    g('paper', 2, [
      v('14pt', 1, { thickness_pt: 14, tier: 'standard' }, true),
      v('16pt', 2, { thickness_pt: 16, tier: 'premium' }),
      v('17pt_uncoated', 3, { thickness_pt: 17, tier: 'premium' }),
    ]),
    g('coating', 3, [
      v('matte_both', 1, { front: 'matte', back: 'matte' }, true),
      v('gloss_both', 2, { front: 'gloss', back: 'gloss' }),
      v('uncoated_both', 3, { front: 'none', back: 'none' }),
      v('uv_both', 4, { front: 'uv', back: 'uv' }),
      v('uv_front_uncoated_back', 5, { front: 'uv', back: 'none' }),
      v('uv_front_gloss_back', 6, { front: 'uv', back: 'gloss' }),
      v('soft_touch_both', 7, { front: 'soft_touch', back: 'soft_touch' }),
      v('silk_both', 8, { front: 'silk', back: 'silk' }),
    ]),
    g('printed_side', 4, [
      v('front_back', 1, { back: 'separate' }, true),
      v('front_only', 2, { back: 'blank' }),
      v('same_both', 3, { back: 'same_as_front' }),
    ]),
    g('corners', 5, [v('square', 1, { radius_in: 0 }, true), v('rounded_quarter', 2, { radius_in: 0.25 })]),
    g('turnaround', 6, [
      v('5d', 1, { business_days: 5 }),
      v('3d', 2, { business_days: 3 }, true),
      v('2d', 3, { business_days: 2 }),
      v('1d', 4, { business_days: 1 }),
    ]),
  ],
  rules: [
    { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'coating', allowed: COATING_14 },
    { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'coating', allowed: ['matte_both', 'gloss_both', 'soft_touch_both', 'silk_both'] },
    { whenGroup: 'paper', whenValue: '17pt_uncoated', targetGroup: 'coating', allowed: ['uncoated_both'] },
    { whenGroup: 'paper', whenValue: '17pt_uncoated', targetGroup: 'turnaround', allowed: NO_1D },
    { whenGroup: 'coating', whenValue: 'uv_front_uncoated_back', targetGroup: 'turnaround', allowed: NO_1D },
    { whenGroup: 'coating', whenValue: 'uncoated_both', targetGroup: 'turnaround', allowed: NO_1D },
    {
      whenGroup: 'printed_side',
      whenValue: 'front_only',
      targetGroup: 'coating',
      allowed: ['matte_both', 'gloss_both', 'uncoated_both', 'uv_both', 'soft_touch_both', 'silk_both'],
    },
  ],
  quantityTiers: TIERS.map(([quantity, basePriceCents], i) => ({
    quantity,
    basePriceCents,
    sortOrder: i + 1,
    isDefault: quantity === 500,
  })),
  upcharges: UPCHARGE_PERCENT.flatMap(([group, value, percent]) =>
    TIERS.map(([quantity, base]) => ({ group, value, quantity, upchargeCents: percentOf(base, percent) })),
  ),
};

export const defaultSelection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: '3d',
};
