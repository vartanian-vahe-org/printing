import { describe, expect, it } from 'vitest';
import { isUsPhone, isUsState, isUsZip, orderTotals, priceShippingOption, taxForAmount, US_STATES } from '../src/checkout.js';

const standard = { code: 'standard', label: 'Standard', basePriceCents: 699, freeOverCents: 10000, transitDaysMin: 3, transitDaysMax: 5 };
const overnight = { code: 'overnight', label: 'Overnight', basePriceCents: 2999, freeOverCents: null, transitDaysMin: 1, transitDaysMax: 1 };

describe('priceShippingOption', () => {
  it('charges the base price below the free-shipping threshold', () => {
    expect(priceShippingOption(standard, 9999)).toMatchObject({ priceCents: 699, isFree: false });
  });

  it('is free at or above the threshold ($100.00)', () => {
    expect(priceShippingOption(standard, 10000)).toMatchObject({ priceCents: 0, isFree: true });
  });

  it('never makes a method without threshold free', () => {
    expect(priceShippingOption(overnight, 1_000_000)).toMatchObject({ priceCents: 2999, isFree: false });
  });
});

describe('taxForAmount', () => {
  it('applies basis points and rounds half up', () => {
    expect(taxForAmount(3948, 725)).toBe(286); // 286.23
    expect(taxForAmount(1000, 725)).toBe(73); // 72.5 -> 73
    expect(taxForAmount(200, 725)).toBe(15); // 14.5 -> 15
  });

  it('is zero for no rate or no amount', () => {
    expect(taxForAmount(3948, 0)).toBe(0);
    expect(taxForAmount(0, 725)).toBe(0);
  });
});

describe('orderTotals', () => {
  it('adds subtotal, shipping and tax', () => {
    expect(orderTotals(3948, 699, 286)).toEqual({ subtotalCents: 3948, shippingCents: 699, taxCents: 286, totalCents: 4933 });
  });
});

describe('US address helpers', () => {
  it('knows the 50 states and DC', () => {
    expect(US_STATES).toHaveLength(51);
    expect(isUsState('CA')).toBe(true);
    expect(isUsState('PR')).toBe(false);
    expect(isUsState('ca')).toBe(false);
  });

  it('accepts 5-digit ZIP and ZIP+4', () => {
    expect(isUsZip('94103')).toBe(true);
    expect(isUsZip('94103-1234')).toBe(true);
    expect(isUsZip('9410')).toBe(false);
    expect(isUsZip('ABCDE')).toBe(false);
  });

  it('accepts US phone numbers in common formats', () => {
    expect(isUsPhone('(213) 555-0100')).toBe(true);
    expect(isUsPhone('+1 213-555-0100')).toBe(true);
    expect(isUsPhone('2135550100')).toBe(true);
    expect(isUsPhone('555-0100')).toBe(false);
    expect(isUsPhone('+44 20 7946 0958')).toBe(false);
  });
});
