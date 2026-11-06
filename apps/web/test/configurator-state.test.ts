import { getAllowedValues } from '@printing/pricing';
import { describe, expect, it } from 'vitest';
import { businessCards, defaultSelection } from '../../../packages/pricing/test/fixtures/business-cards.js';
import {
  changeOption,
  changeQuantity,
  initialState,
  optionDeltas,
  priceOf,
  settle,
  speedChoices,
  tierPrices,
  valueLabel,
  groupLabel,
  type ConfiguratorState,
} from '../lib/configurator-state.js';

const start = (): ConfiguratorState => initialState(businessCards, { selection: defaultSelection, quantity: 500 });

describe('configurator state', () => {
  it('starts from the defaults at $39.48', () => {
    expect(priceOf(businessCards, start()).totalCents).toBe(3948);
  });

  it('reports cascading auto changes when switching to 17pt', () => {
    const withOneDay = changeOption(businessCards, start(), 'turnaround', 'rush').state;
    const { state, autoChanges } = changeOption(businessCards, withOneDay, 'paper', '17pt_uncoated');
    expect(state.selection).toMatchObject({ paper: '17pt_uncoated', coating: 'uncoated_both', turnaround: 'standard' });
    expect(autoChanges).toEqual([
      { group: 'coating', from: 'matte_both', to: 'uncoated_both' },
      { group: 'turnaround', from: 'rush', to: 'standard' },
    ]);
  });

  it('moves the quantity when the new options are not sold at it, and says so', () => {
    const catalog = { ...businessCards, corePrices: businessCards.corePrices.filter((p) => !(p.paper === '16pt' && p.quantity === 500)) };
    const initial = initialState(catalog, { selection: defaultSelection, quantity: 500 });
    const { state, autoChanges } = changeOption(catalog, initial, 'paper', '16pt');
    expect(state.quantity).toBe(1000);
    expect(autoChanges).toContainEqual({ group: 'quantity', from: '500', to: '1000' });
    expect(`${groupLabel(catalog, 'quantity')} ${valueLabel(catalog, 'quantity', '1000')}`).toBe('Quantity 1,000');
    expect(tierPrices(catalog, state).map((t) => t.quantity)).not.toContain(500);
  });

  it('settles a stale draft: unknown size, and a quantity no longer sold', () => {
    expect(settle(businessCards, { ...defaultSelection, size: 'custom' }, 300)).toMatchObject({ selection: { size: 'std_3_5x2' }, quantity: 500 });
  });
});

describe('option price hints', () => {
  it('shows differences relative to the current selection', () => {
    const state = start();
    const deltas = optionDeltas(businessCards, state, getAllowedValues(businessCards, state.selection, state.quantity));
    // 17pt moves the coating to uncoated (+4%) too.
    expect(deltas.paper).toEqual({ '14pt': 0, '16pt': 625, '17pt_uncoated': 4148 + 324 });
    expect(deltas.printed_side!.front_only).toBe(-1449);
    expect(deltas.size!.square_2_5).toBe(Math.round(3948 * 1.96) - 3948);
  });

  it('lists the price at every quantity tier', () => {
    const prices = tierPrices(businessCards, start());
    expect(prices[0]).toEqual({ quantity: 50, isDefault: false, totalCents: 1000 + 580, unitPriceCents: 32 });
    expect(prices.find((p) => p.isDefault)?.totalCents).toBe(3948);
  });
});

describe('turnaround by quantity', () => {
  it('switches a speed that is not offered at the new quantity, and says so', () => {
    const rush = changeOption(businessCards, start(), 'turnaround', 'rush').state;
    const { state, autoChanges } = changeQuantity(businessCards, rush, 10000);
    expect(state).toMatchObject({ quantity: 10000, selection: { turnaround: 'standard' } });
    expect(autoChanges).toEqual([{ group: 'turnaround', from: 'rush', to: 'standard' }]);
  });

  it('lists speeds with their days, and dims the ones not offered at the quantity', () => {
    const at = (quantity: number) => speedChoices(businessCards, changeQuantity(businessCards, start(), quantity).state);
    expect(at(500).map((s) => [s.code, s.businessDays])).toEqual([
      ['economy', 5],
      ['standard', 3],
      ['express', 2],
      ['rush', 1],
    ]);
    expect(at(10000).find((s) => s.code === 'rush')).toEqual({ code: 'rush', minBusinessDays: null, businessDays: null, unavailable: 'Up to 5,000 cards' });
  });

  it('leaves out speeds hidden by a rule', () => {
    const state = changeOption(businessCards, start(), 'paper', '17pt_uncoated').state;
    expect(speedChoices(businessCards, state).map((s) => s.code)).toEqual(['economy', 'standard', 'express']);
  });

  it('prices each quantity with the speed it would switch to', () => {
    const rush = changeOption(businessCards, start(), 'turnaround', 'rush').state;
    const prices = tierPrices(businessCards, rush);
    expect(prices.find((p) => p.quantity === 500)!.totalCents).toBe(3948 + Math.round(3948 * 0.8));
    expect(prices.find((p) => p.quantity === 10000)!.totalCents).toBe(priceOf(businessCards, changeQuantity(businessCards, start(), 10000).state).totalCents);
  });
});

