import { describe, expect, it } from 'vitest';
import { getAllowedValues, nearestQuantity, offeredQuantities, resolveSelection, UnsatisfiableSelectionError } from '../src/rules.js';
import type { Catalog, CorePrice } from '../src/types.js';
import { businessCards, defaultSelection } from './fixtures/business-cards.js';

describe('getAllowedValues', () => {
  it('R1: 14pt allows the six non-laminated coatings', () => {
    const allowed = getAllowedValues(businessCards, defaultSelection, 500);
    expect(allowed.coating).toEqual([
      'matte_both',
      'gloss_both',
      'uncoated_both',
      'uv_both',
      'uv_front_uncoated_back',
      'uv_front_gloss_back',
    ]);
  });

  it('R2: 16pt allows matte, gloss and the laminated finishes', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, paper: '16pt' }, 500);
    expect(allowed.coating).toEqual(['matte_both', 'gloss_both', 'soft_touch_both', 'silk_both']);
  });

  it('R3 + R4: 17pt is uncoated only and has no rush', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, paper: '17pt_uncoated' }, 500);
    expect(allowed.coating).toEqual(['uncoated_both']);
    expect(allowed.turnaround).toEqual(['economy', 'standard', 'express']);
  });

  it('R5: UV front / uncoated back has no rush', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, coating: 'uv_front_uncoated_back' }, 500);
    expect(allowed.turnaround).toEqual(['economy', 'standard', 'express']);
  });

  it('R6: uncoated has no rush', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, coating: 'uncoated_both' }, 500);
    expect(allowed.turnaround).toEqual(['economy', 'standard', 'express']);
  });

  it('R7 intersects with R1: front only on 14pt hides the "UV front, ... back" coatings', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, printed_side: 'front_only' }, 500);
    expect(allowed.coating).toEqual(['matte_both', 'gloss_both', 'uncoated_both', 'uv_both']);
  });

  it('does not restrict groups without triggered rules', () => {
    const allowed = getAllowedValues(businessCards, defaultSelection, 500);
    expect(allowed.size).toEqual(['std_3_5x2', 'square_2_5', 'slim_3_5x1_75']);
    expect(allowed.turnaround).toEqual(['economy', 'standard', 'express', 'rush']);
  });

  it('keeps only the speeds offered at the quantity', () => {
    expect(getAllowedValues(businessCards, defaultSelection, 10000).turnaround).toEqual(['economy', 'standard', 'express']);
  });
});

describe('resolveSelection', () => {
  it('fills an empty selection with group defaults', () => {
    expect(resolveSelection(businessCards, {}, 500)).toEqual(defaultSelection);
  });

  it('replaces unknown values with the default', () => {
    expect(resolveSelection(businessCards, { ...defaultSelection, paper: 'gold_leaf' }, 500).paper).toBe('14pt');
  });

  it('cascades: switching to 17pt fixes coating and then turnaround', () => {
    const resolved = resolveSelection(businessCards, {
      ...defaultSelection,
      paper: '17pt_uncoated',
      coating: 'gloss_both',
      turnaround: 'rush',
    }, 500);
    expect(resolved.coating).toBe('uncoated_both');
    expect(resolved.turnaround).toBe('standard');
  });

  it('falls back to the group default when it is allowed', () => {
    const resolved = resolveSelection(businessCards, {
      ...defaultSelection,
      printed_side: 'front_only',
      coating: 'uv_front_uncoated_back',
    }, 500);
    expect(resolved.coating).toBe('matte_both');
  });

  it('falls back to the first allowed value when the default is hidden', () => {
    const resolved = resolveSelection(businessCards, { ...defaultSelection, paper: '17pt_uncoated' }, 500);
    expect(resolved.coating).toBe('uncoated_both');
  });

  it('keeps a valid selection unchanged', () => {
    const selection = { ...defaultSelection, paper: '16pt', coating: 'soft_touch_both', turnaround: 'rush' };
    expect(resolveSelection(businessCards, selection, 500)).toEqual(selection);
  });

  it('switches a speed that is not offered at the new quantity to the default', () => {
    expect(resolveSelection(businessCards, { ...defaultSelection, turnaround: 'rush' }, 10000).turnaround).toBe('standard');
  });

  it('throws when rules leave a group with no values', () => {
    const broken: Catalog = {
      ...businessCards,
      rules: [...businessCards.rules, { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'corners', allowed: [] }],
    };
    expect(() => resolveSelection(broken, defaultSelection, 500)).toThrow(UnsatisfiableSelectionError);
  });
});

describe('core combinations without a price', () => {
  const without = (drop: (p: CorePrice) => boolean) => ({ ...businessCards, corePrices: businessCards.corePrices.filter((p) => !drop(p)) });

  it('narrows paper by size and printed sides by size and paper', () => {
    const catalog = without((p) => (p.size === 'slim_3_5x1_75' && p.paper === '17pt_uncoated') || (p.paper === '16pt' && p.printedSide === 'same_both'));
    const allowed = getAllowedValues(catalog, { ...defaultSelection, size: 'slim_3_5x1_75', paper: '16pt' }, 500);
    expect(allowed.paper).toEqual(['14pt', '16pt']);
    expect(allowed.printed_side).toEqual(['front_back', 'front_only']);
    expect(allowed.size).toEqual(['std_3_5x2', 'square_2_5', 'slim_3_5x1_75']);
  });

  it('keeps the size the customer picked and moves the paper', () => {
    const catalog = without((p) => p.size === 'slim_3_5x1_75' && p.paper === '17pt_uncoated');
    const selection = resolveSelection(catalog, { ...defaultSelection, size: 'slim_3_5x1_75', paper: '17pt_uncoated', coating: 'uncoated_both' }, 500);
    expect(selection).toMatchObject({ size: 'slim_3_5x1_75', paper: '14pt' });
  });

  it('lists the quantities sold and finds the nearest one', () => {
    const catalog = without((p) => p.paper === '16pt' && (p.quantity === 500 || p.quantity === 10000));
    const selection = { ...defaultSelection, paper: '16pt' };
    expect(offeredQuantities(catalog, selection)).toEqual([50, 100, 250, 1000, 2500, 5000]);
    expect(nearestQuantity(catalog, selection, 250)).toBe(250);
    expect(nearestQuantity(catalog, selection, 500)).toBe(1000);
    expect(nearestQuantity(catalog, selection, 10000)).toBe(5000);
  });
});
