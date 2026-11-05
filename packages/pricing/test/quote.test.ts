import { describe, expect, it } from 'vitest';
import {
  defaultQuantity,
  InvalidConfigurationError,
  quote,
  resolveAndQuote,
  validateConfiguration,
} from '../src/quote.js';
import { businessCards, defaultSelection } from './fixtures/business-cards.js';

describe('quote', () => {
  it('default quantity is 500', () => {
    expect(defaultQuantity(businessCards)).toBe(500);
  });

  it('charges the set price of the core options', () => {
    const q = quote(businessCards, { selection: defaultSelection, quantity: 500 });
    expect(q.corePriceCents).toBe(3948);
    expect(q.printingCents).toBe(3948);
    expect(q.totalCents).toBe(3948);
    expect(q.unitPriceCents).toBe(8);
    expect(q.lines.map((l) => l.group)).toEqual(['paper', 'printed_side', 'coating', 'corners', 'turnaround']);
  });

  it('has a set price per combination, not a sum of its parts', () => {
    const price = (selection: Record<string, string>, quantity = 500) =>
      quote(businessCards, { selection: { ...defaultSelection, ...selection }, quantity }).totalCents;
    expect(price({ printed_side: 'front_only' })).toBe(2499);
    expect(price({ size: 'square_2_5', printed_side: 'front_only' })).toBe(4898);
    const custom = {
      ...businessCards,
      corePrices: businessCards.corePrices.map((p) =>
        p.size === 'std_3_5x2' && p.paper === '16pt' && p.printedSide === 'front_back' && p.quantity === 500 ? { ...p, priceCents: 2660 } : p,
      ),
    };
    expect(quote(custom, { selection: { ...defaultSelection, paper: '16pt' }, quantity: 500 }).totalCents).toBe(2660);
  });

  it('adds add-ons as a percent of the core price, then the rush percent on the printing price', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, coating: 'gloss_both', corners: 'rounded_quarter', turnaround: 'rush' },
      quantity: 500,
    });
    // core 3948; gloss 4% = 158, rounded 30% = 1184
    expect(q.lines.find((l) => l.group === 'coating')).toMatchObject({ upchargeCents: 158, percent: 4 });
    expect(q.lines.find((l) => l.group === 'corners')).toMatchObject({ upchargeCents: 1184, percent: 30 });
    expect(q.printingCents).toBe(3948 + 158 + 1184);
    expect(q.lines.find((l) => l.group === 'turnaround')).toMatchObject({ upchargeCents: 4232, percent: 80 });
    expect(q.totalCents).toBe(5290 + 4232);
    expect(q.businessDays).toBe(1);
  });

  it('takes a negative percent off for the slowest speed', () => {
    const q = quote(businessCards, { selection: { ...defaultSelection, turnaround: 'economy' }, quantity: 500 });
    expect(q.totalCents).toBe(3948 - Math.round(3948 * 0.1));
    expect(q.businessDays).toBe(5);
  });

  it('uses the days of the quantity band', () => {
    expect(quote(businessCards, { selection: { ...defaultSelection, turnaround: 'express' }, quantity: 2500 }).businessDays).toBe(3);
    expect(quote(businessCards, { selection: defaultSelection, quantity: 10000 }).businessDays).toBe(5);
  });

  it('rejects a speed not offered at the quantity', () => {
    expect(() => quote(businessCards, { selection: { ...defaultSelection, turnaround: 'rush' }, quantity: 10000 })).toThrow(
      '"rush" is not available for "turnaround"',
    );
  });

  it('rejects a value hidden by a rule', () => {
    expect(() =>
      quote(businessCards, { selection: { ...defaultSelection, paper: '17pt_uncoated' }, quantity: 500 }),
    ).toThrow(InvalidConfigurationError);
  });

  it('rejects a quantity that is not a tier', () => {
    expect(() => quote(businessCards, { selection: defaultSelection, quantity: 300 })).toThrow('Quantity 300');
  });

  it('rejects a combination with no price at the quantity', () => {
    const catalog = { ...businessCards, corePrices: businessCards.corePrices.filter((p) => !(p.paper === '16pt' && p.quantity === 500)) };
    expect(() => quote(catalog, { selection: { ...defaultSelection, paper: '16pt' }, quantity: 500 })).toThrow(
      'Quantity 500 is not available with these options',
    );
  });
});

describe('validateConfiguration', () => {
  it('reports every issue at once', () => {
    const issues = validateConfiguration(businessCards, {
      selection: { ...defaultSelection, paper: '17pt_uncoated', corners: 'scalloped', foil: 'gold' },
      quantity: 7,
    });
    expect(issues).toEqual([
      '"matte_both" is not available for "coating" with the other options selected',
      'Unknown value "scalloped" for "corners"',
      'Unknown option group "foil"',
      'Quantity 7 is not available',
    ]);
  });

  it('accepts a valid configuration', () => {
    expect(validateConfiguration(businessCards, { selection: defaultSelection, quantity: 500 })).toEqual([]);
  });
});

describe('resolveAndQuote', () => {
  it('fixes a stale selection before pricing', () => {
    const q = resolveAndQuote(businessCards, {
      selection: { paper: '17pt_uncoated', turnaround: 'rush' },
      quantity: 1000,
    });
    expect(q.selection).toMatchObject({ coating: 'uncoated_both', turnaround: 'standard' });
    // core 3799 + 17pt 6306 + front & back 2203 = 12308; uncoated +4% = 492
    expect(q.totalCents).toBe(12308 + 492);
  });
});
