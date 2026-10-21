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
    ['turnaround', '5d', 500, -250],
    ['turnaround', '1d', 500, 1999],
    ['turnaround', '1d', 10000, 17839],
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

  it('adds every upcharge: 16pt gloss, front & back, rounded, 1 day', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, paper: '16pt', coating: 'gloss_both', corners: 'rounded_quarter', turnaround: '1d' },
      quantity: 500,
    });
    // 2499 + 625 + 175 + 1449 + 1175 + 1999
    expect(q.totalCents).toBe(7922);
  });

  it('applies the preset size multiplier to the whole subtotal', () => {
    const q = quote(businessCards, {
      selection: { ...defaultSelection, size: 'square_2_5', paper: '16pt', coating: 'gloss_both', corners: 'rounded_quarter', turnaround: '1d' },
      quantity: 500,
    });
    expect(q.totalCents).toBe(Math.round(7922 * 1.96)); // 15527
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
      selection: { paper: '17pt_uncoated', turnaround: '1d' },
      quantity: 1000,
    });
    expect(q.selection).toMatchObject({ coating: 'uncoated_both', turnaround: '3d' });
    // 3799 + 17pt 6306 + uncoated 266 + front & back 2203
    expect(q.totalCents).toBe(3799 + 6306 + 266 + 2203);
  });
});
