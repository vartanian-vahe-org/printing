import { describe, expect, it } from 'vitest';
import { customSizeMultiplier, InvalidCustomSizeError, resolveSize } from '../src/size.js';
import type { CustomSizeAttributes } from '../src/types.js';
import { businessCards } from './fixtures/business-cards.js';

const customAttrs = businessCards.groups
  .find((g) => g.code === 'size')!
  .values.find((v) => v.code === 'custom')!.attributes as unknown as CustomSizeAttributes;

describe('customSizeMultiplier (spec §4.3, checked against UPrinting at 500 cards)', () => {
  it.each([
    [2, 2, 1.25],
    [2, 3, 1.25],
    [3, 2, 1.25],
    [2, 4, 2.264],
    [2.5, 3.5, 2.47625],
    [3, 3, 2.547],
    [3, 4, 3.396],
    [4, 4, 4.528],
  ])('%s" x %s" -> %s', (widthIn, heightIn, expected) => {
    expect(customSizeMultiplier(customAttrs, { widthIn, heightIn })).toBeCloseTo(expected, 6);
  });
});

describe('resolveSize', () => {
  it('returns preset dimensions and multiplier', () => {
    expect(resolveSize(businessCards, 'square_2_5')).toMatchObject({
      code: 'square_2_5',
      widthIn: 2.5,
      heightIn: 2.5,
      bleedIn: 0.125,
      safeIn: 0.125,
      priceMultiplier: 1.96,
    });
  });

  it('switches custom dimensions that exactly match a preset to that preset', () => {
    expect(resolveSize(businessCards, 'custom', { widthIn: 3.5, heightIn: 2 })).toMatchObject({
      code: 'std_3_5x2',
      priceMultiplier: 1,
    });
  });

  it('keeps a rotated preset as custom (portrait design) but prices it like the preset', () => {
    expect(resolveSize(businessCards, 'custom', { widthIn: 2, heightIn: 3.5 })).toMatchObject({
      code: 'custom',
      widthIn: 2,
      heightIn: 3.5,
      priceMultiplier: 1,
      pricedAsCode: 'std_3_5x2',
    });
  });

  it('prices other custom sizes with the formula', () => {
    expect(resolveSize(businessCards, 'custom', { widthIn: 3, heightIn: 3 })).toMatchObject({
      code: 'custom',
      pricedAsCode: null,
    });
    expect(resolveSize(businessCards, 'custom', { widthIn: 3, heightIn: 3 }).priceMultiplier).toBeCloseTo(2.547, 6);
  });

  it.each([
    [{ widthIn: 1.75, heightIn: 3 }, 'between'],
    [{ widthIn: 3, heightIn: 4.25 }, 'between'],
    [{ widthIn: 2.1, heightIn: 3 }, 'steps'],
    [{ widthIn: Number.NaN, heightIn: 3 }, 'number'],
  ])('rejects invalid custom size %o', (size, message) => {
    expect(() => resolveSize(businessCards, 'custom', size)).toThrow(InvalidCustomSizeError);
    expect(() => resolveSize(businessCards, 'custom', size)).toThrow(message);
  });

  it('requires dimensions for a custom size', () => {
    expect(() => resolveSize(businessCards, 'custom')).toThrow(InvalidCustomSizeError);
  });

  it('cannot reach the Slim preset as a custom size (1.75" is below the 2" minimum)', () => {
    expect(() => resolveSize(businessCards, 'custom', { widthIn: 3.5, heightIn: 1.75 })).toThrow('between');
  });

  it('accepts the range limits', () => {
    expect(() => resolveSize(businessCards, 'custom', { widthIn: 2, heightIn: 4 })).not.toThrow();
  });
});
