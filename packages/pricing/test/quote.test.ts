import { describe, expect, it } from 'vitest';
import {
  defaultQuantity,
  InvalidConfigurationError,
  quote,
  resolveAndQuote,
  upchargeFor,
  validateConfiguration,
} from '../src/quote.js';
import { businessCards, defaultSelection } from './fixtures/business-cards.js';

describe('upcharges match the seeded values in packages/db (checked in psql)', () => {
  it.each([
    ['paper', '16pt', 500, 625],
    ['printed_side', 'front_back', 500, 1449],
    ['corners', 'rounded_quarter', 500, 1175],
    ['printed_side', 'front_back', 50, 580],
  ])('%s.%s @ %i = %i cents', (group, value, quantity, cents) => {
    expect(upchargeFor(businessCards, group, value, quantity)).toBe(cents);
  });

  it('has no upcharge for default values', () => {
    expect(upchargeFor(businessCards, 'paper', '14pt', 500)).toBe(0);
  });
});

describe('quote', () => {
  it('default quantity is 500', () => {
    expect(defaultQuantity(businessCards)).toBe(500);
  });

  it('base configuration (front only) equals the Vistaprint base price', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, printed_side: 'front_only' },
      quantity: 500,
    });
    expect(q.totalCents).toBe(2499);
    expect(q.unitPriceCents).toBe(5);
  });

  it('default configuration = base + front & back upcharge', () => {
    const q = quote(businessCards, { selection: defaultSelection, quantity: 500 });
    expect(q.basePriceCents).toBe(2499);
    expect(q.subtotalCents).toBe(2499 + 1449);
    expect(q.totalCents).toBe(3948);
    expect(q.lines.map((l) => l.group)).toEqual(['paper', 'coating', 'printed_side', 'corners', 'turnaround']);
  });

  it('adds every upcharge, then the rush percent on the printing price', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, paper: '16pt', coating: 'gloss_both', corners: 'rounded_quarter', turnaround: 'rush' },
      quantity: 500,
    });
    // printing 2499 + 625 + 175 + 1449 + 1175 = 5923; rush +80% = 4738
    expect(q.subtotalCents).toBe(5923);
    expect(q.lines.find((l) => l.group === 'turnaround')).toMatchObject({ upchargeCents: 4738, percent: 80 });
    expect(q.totalCents).toBe(5923 + 4738);
    expect(q.businessDays).toBe(1);
  });

  it('applies the size multiplier before the turnaround percent', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, size: 'square_2_5', paper: '16pt', coating: 'gloss_both', corners: 'rounded_quarter', turnaround: 'rush' },
      quantity: 500,
    });
    const printing = Math.round(5923 * 1.96); // 11609
    expect(q.totalCents).toBe(printing + Math.round(printing * 0.8)); // 20896
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

  it('applies the custom size formula', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, size: 'custom' },
      quantity: 500,
      customSize: { widthIn: 3, heightIn: 3 },
    });
    expect(q.totalCents).toBe(Math.round(3948 * 2.547)); // 10056
    expect(q.size).toMatchObject({ code: 'custom', widthIn: 3, heightIn: 3 });
  });

  it('stores the preset code when custom dimensions match a preset', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, size: 'custom' },
      quantity: 500,
      customSize: { widthIn: 2.5, heightIn: 2.5 },
    });
    expect(q.selection.size).toBe('square_2_5');
    expect(q.totalCents).toBe(Math.round(3948 * 1.96));
  });

  it('rejects a value hidden by a rule', () => {
    expect(() =>
      quote(businessCards, { selection: { ...defaultSelection, paper: '17pt_uncoated' }, quantity: 500 }),
    ).toThrow(InvalidConfigurationError);
  });

  it('rejects a quantity that is not a tier', () => {
    expect(() => quote(businessCards, { selection: defaultSelection, quantity: 300 })).toThrow('Quantity 300');
  });

  it('rejects a missing custom size', () => {
    expect(() => quote(businessCards, { selection: { ...defaultSelection, size: 'custom' }, quantity: 500 })).toThrow(
      'Width and height are required',
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
    // 3799 + 17pt 6306 + uncoated 266 + front & back 2203
    expect(q.totalCents).toBe(3799 + 6306 + 266 + 2203);
  });
});
