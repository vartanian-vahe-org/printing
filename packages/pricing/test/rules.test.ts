import { describe, expect, it } from 'vitest';
import { getAllowedValues, resolveSelection, UnsatisfiableSelectionError } from '../src/rules.js';
import type { Catalog } from '../src/types.js';
import { businessCards, defaultSelection } from './fixtures/business-cards.js';

describe('getAllowedValues', () => {
  it('R1: 14pt allows the six non-laminated coatings', () => {
    const allowed = getAllowedValues(businessCards, defaultSelection);
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
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, paper: '16pt' });
    expect(allowed.coating).toEqual(['matte_both', 'gloss_both', 'soft_touch_both', 'silk_both']);
  });

  it('R3 + R4: 17pt is uncoated only and has no 1-day turnaround', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, paper: '17pt_uncoated' });
    expect(allowed.coating).toEqual(['uncoated_both']);
    expect(allowed.turnaround).toEqual(['5d', '3d', '2d']);
  });

  it('R5: UV front / uncoated back has no 1-day turnaround', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, coating: 'uv_front_uncoated_back' });
    expect(allowed.turnaround).toEqual(['5d', '3d', '2d']);
  });

  it('R6: uncoated has no 1-day turnaround', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, coating: 'uncoated_both' });
    expect(allowed.turnaround).toEqual(['5d', '3d', '2d']);
  });

  it('R7 intersects with R1: front only on 14pt hides the "UV front, ... back" coatings', () => {
    const allowed = getAllowedValues(businessCards, { ...defaultSelection, printed_side: 'front_only' });
    expect(allowed.coating).toEqual(['matte_both', 'gloss_both', 'uncoated_both', 'uv_both']);
  });

  it('does not restrict groups without triggered rules', () => {
    const allowed = getAllowedValues(businessCards, defaultSelection);
    expect(allowed.size).toEqual(['std_3_5x2', 'square_2_5', 'slim_3_5x1_75', 'custom']);
    expect(allowed.turnaround).toEqual(['5d', '3d', '2d', '1d']);
  });
});

describe('resolveSelection', () => {
  it('fills an empty selection with group defaults', () => {
    expect(resolveSelection(businessCards, {})).toEqual(defaultSelection);
  });

  it('replaces unknown values with the default', () => {
    expect(resolveSelection(businessCards, { ...defaultSelection, paper: 'gold_leaf' }).paper).toBe('14pt');
  });

  it('cascades: switching to 17pt fixes coating and then turnaround', () => {
    const resolved = resolveSelection(businessCards, {
      ...defaultSelection,
      paper: '17pt_uncoated',
      coating: 'gloss_both',
      turnaround: '1d',
    });
    expect(resolved.coating).toBe('uncoated_both');
    expect(resolved.turnaround).toBe('3d');
  });

  it('falls back to the group default when it is allowed', () => {
    const resolved = resolveSelection(businessCards, {
      ...defaultSelection,
      printed_side: 'front_only',
      coating: 'uv_front_uncoated_back',
    });
    expect(resolved.coating).toBe('matte_both');
  });

  it('falls back to the first allowed value when the default is hidden', () => {
    const resolved = resolveSelection(businessCards, { ...defaultSelection, paper: '17pt_uncoated' });
    expect(resolved.coating).toBe('uncoated_both');
  });

  it('keeps a valid selection unchanged', () => {
    const selection = { ...defaultSelection, paper: '16pt', coating: 'soft_touch_both', turnaround: '1d' };
    expect(resolveSelection(businessCards, selection)).toEqual(selection);
  });

  it('throws when rules leave a group with no values', () => {
    const broken: Catalog = {
      ...businessCards,
      rules: [...businessCards.rules, { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'corners', allowed: [] }],
    };
    expect(() => resolveSelection(broken, defaultSelection)).toThrow(UnsatisfiableSelectionError);
  });
});
