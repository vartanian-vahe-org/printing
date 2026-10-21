import { getAllowedValues } from '@printing/pricing';
import { describe, expect, it } from 'vitest';
import { businessCards, defaultSelection } from '../../../packages/pricing/test/fixtures/business-cards.js';
import {
  changeCustomSize,
  changeOption,
  customSizeSteps,
  initialState,
  optionDeltas,
  priceOf,
  tierPrices,
  type ConfiguratorState,
} from '../lib/configurator-state.js';

const start = (): ConfiguratorState => initialState(businessCards, { selection: defaultSelection, quantity: 500 });

describe('configurator state', () => {
  it('starts from the defaults at $39.48', () => {
    expect(priceOf(businessCards, start()).totalCents).toBe(3948);
  });

  it('reports cascading auto changes when switching to 17pt', () => {
    const withOneDay = changeOption(businessCards, start(), 'turnaround', '1d').state;
    const { state, autoChanges } = changeOption(businessCards, withOneDay, 'paper', '17pt_uncoated');
    expect(state.selection).toMatchObject({ paper: '17pt_uncoated', coating: 'uncoated_both', turnaround: '3d' });
    expect(autoChanges).toEqual([
      { group: 'coating', from: 'matte_both', to: 'uncoated_both' },
      { group: 'turnaround', from: '1d', to: '3d' },
    ]);
  });

  it('switches a custom size that matches a preset to the preset', () => {
    const custom = changeOption(businessCards, start(), 'size', 'custom').state;
    const { state, autoChanges } = changeCustomSize(businessCards, custom, { widthIn: 2.5, heightIn: 2.5 });
    expect(state.selection.size).toBe('square_2_5');
    expect(autoChanges).toEqual([{ group: 'size', from: 'custom', to: 'square_2_5' }]);
  });

  it('keeps a non-preset custom size and prices it with the formula', () => {
    const custom = changeOption(businessCards, start(), 'size', 'custom').state;
    const { state } = changeCustomSize(businessCards, custom, { widthIn: 3, heightIn: 3 });
    expect(state.selection.size).toBe('custom');
    expect(priceOf(businessCards, state).totalCents).toBe(10056);
  });

  it('builds 2"-4" custom steps of 0.25"', () => {
    const steps = customSizeSteps({
      min_in: 2,
      max_in: 4,
      step_in: 0.25,
      bleed_in: 0.125,
      safe_in: 0.125,
      fit_box: { w_in: 3.5, h_in: 2 },
      fit_multiplier: 1.25,
      area_multiplier: 0.283,
    });
    expect(steps).toEqual([2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4]);
  });
});

describe('option price hints', () => {
  it('shows upcharges relative to the current selection', () => {
    const state = start();
    const deltas = optionDeltas(businessCards, state, getAllowedValues(businessCards, state.selection));
    expect(deltas.paper).toEqual({ '14pt': 0, '16pt': 625, '17pt_uncoated': 4148 + 175 });
    expect(deltas.printed_side!.front_only).toBe(-1449);
    expect(deltas.size!.square_2_5).toBe(Math.round(3948 * 1.96) - 3948);
  });

  it('lists the price at every quantity tier', () => {
    const prices = tierPrices(businessCards, start());
    expect(prices[0]).toEqual({ quantity: 50, isDefault: false, totalCents: 1000 + 580, unitPriceCents: 32 });
    expect(prices.find((p) => p.isDefault)?.totalCents).toBe(3948);
  });
});
