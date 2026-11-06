/**
 * Mirrors the seeded defaults in packages/db/migrations (spec docs/specs/business-card-mvp.md).
 * If the seed changes, update this fixture; the API integration test (step 4) checks the real DB.
 */
import type { Catalog, OptionGroup, OptionValue } from '../../src/types.js';

const B = 0.125;

function v(code: string, sortOrder: number, attributes: Record<string, unknown> = {}, isDefault = false, addonPercent = 0): OptionValue {
  return { code, label: code, description: null, sortOrder, isDefault, attributes, addonPercent };
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

/** Migration 0027: each combination starts at (base + paper % + printed sides %) × size % of the base price. */
const SIZES: [string, number][] = [
  ['std_3_5x2', 100],
  ['square_2_5', 196],
  ['slim_3_5x1_75', 131],
];
const PAPERS: [string, number][] = [
  ['14pt', 0],
  ['16pt', 25],
  ['17pt_uncoated', 166],
];
const SIDES: [string, number][] = [
  ['front_back', 58],
  ['front_only', 0],
  ['same_both', 58],
];

/** Quantity × speed table seeded by migration 0025: [speed, percent, days per quantity band]. */
const SPEEDS: [string, number, number][] = [
  ['economy', -10, 5],
  ['standard', 0, 3],
  ['express', 30, 2],
  ['rush', 80, 1],
];
/** Extra days by quantity band: up to 1,000 / 2,500–5,000 / 10,000. Rush is not offered at 10,000. */
function extraDays(quantity: number): number {
  return quantity <= 1000 ? 0 : quantity <= 5000 ? 1 : 2;
}

/** Same rounding as the SQL generator: half away from zero, to the cent. */
function percentOf(base: number, percent: number): number {
  const exact = (base * percent) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

const COATING_14 = ['matte_both', 'gloss_both', 'uncoated_both', 'uv_both', 'uv_front_uncoated_back', 'uv_front_gloss_back'];
const NO_RUSH = ['economy', 'standard', 'express'];

export const businessCards: Catalog = {
  product: { code: 'business-cards', name: 'Business Cards', unitName: 'card', unitNamePlural: 'cards' },
  groups: [
    g('size', 1, [
      v('std_3_5x2', 1, { trim_w_in: 3.5, trim_h_in: 2, bleed_in: B, safe_in: B }, true),
      v('square_2_5', 2, { trim_w_in: 2.5, trim_h_in: 2.5, bleed_in: B, safe_in: B }),
      v('slim_3_5x1_75', 3, { trim_w_in: 3.5, trim_h_in: 1.75, bleed_in: B, safe_in: B }),
    ]),
    g('paper', 2, [
      v('14pt', 1, { thickness_pt: 14, tier: 'standard' }, true),
      v('16pt', 2, { thickness_pt: 16, tier: 'premium' }),
      v('17pt_uncoated', 3, { thickness_pt: 17, tier: 'premium' }),
    ]),
    g('printed_side', 3, [
      v('front_back', 1, { back: 'separate' }, true),
      v('front_only', 2, { back: 'blank' }),
      v('same_both', 3, { back: 'same_as_front' }),
    ]),
    g('coating', 4, [
      v('matte_both', 1, { front: 'matte', back: 'matte' }, true),
      v('gloss_both', 2, { front: 'gloss', back: 'gloss' }, false, 4),
      v('uncoated_both', 3, { front: 'none', back: 'none' }, false, 4),
      v('uv_both', 4, { front: 'uv', back: 'uv' }, false, 4),
      v('uv_front_uncoated_back', 5, { front: 'uv', back: 'none' }, false, 27),
      v('uv_front_gloss_back', 6, { front: 'uv', back: 'gloss' }, false, 27),
      v('soft_touch_both', 7, { front: 'soft_touch', back: 'soft_touch' }, false, 15),
      v('silk_both', 8, { front: 'silk', back: 'silk' }, false, 15),
    ]),
    g('corners', 5, [v('square', 1, { radius_in: 0 }, true), v('rounded_quarter', 2, { radius_in: 0.25 }, false, 30)]),
    g('turnaround', 6, [
      v('economy', 1),
      v('standard', 2, {}, true),
      v('express', 3),
      v('rush', 4),
    ]),
  ],
  rules: [
    { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'coating', allowed: COATING_14 },
    { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'coating', allowed: ['matte_both', 'gloss_both', 'soft_touch_both', 'silk_both'] },
    { whenGroup: 'paper', whenValue: '17pt_uncoated', targetGroup: 'coating', allowed: ['uncoated_both'] },
    { whenGroup: 'paper', whenValue: '17pt_uncoated', targetGroup: 'turnaround', allowed: NO_RUSH },
    { whenGroup: 'coating', whenValue: 'uv_front_uncoated_back', targetGroup: 'turnaround', allowed: NO_RUSH },
    { whenGroup: 'coating', whenValue: 'uncoated_both', targetGroup: 'turnaround', allowed: NO_RUSH },
    {
      whenGroup: 'printed_side',
      whenValue: 'front_only',
      targetGroup: 'coating',
      allowed: ['matte_both', 'gloss_both', 'uncoated_both', 'uv_both', 'soft_touch_both', 'silk_both'],
    },
  ],
  quantityTiers: TIERS.map(([quantity], i) => ({
    quantity,
    sortOrder: i + 1,
    isDefault: quantity === 500,
  })),
  corePrices: SIZES.flatMap(([size, sizePercent]) =>
    PAPERS.flatMap(([paper, paperPercent]) =>
      SIDES.flatMap(([printedSide, sidesPercent]) =>
        TIERS.map(([quantity, base]) => ({
          size,
          paper,
          printedSide,
          quantity,
          priceCents: Math.round(((base + percentOf(base, paperPercent) + percentOf(base, sidesPercent)) * sizePercent) / 100),
        })),
      ),
    ),
  ),
  turnarounds: SPEEDS.flatMap(([value, percent, days]) =>
    TIERS.filter(([quantity]) => !(value === 'rush' && quantity > 5000)).map(([quantity]) => ({
      value,
      quantity,
      minBusinessDays: Math.max(days + extraDays(quantity) - 1, 1),
      businessDays: days + extraDays(quantity),
      percent,
    })),
  ),
};

export const defaultSelection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: 'standard',
};
