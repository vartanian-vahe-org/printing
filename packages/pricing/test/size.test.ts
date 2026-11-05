import { describe, expect, it } from 'vitest';
import { resolveSize } from '../src/size.js';
import { businessCards } from './fixtures/business-cards.js';

describe('resolveSize', () => {
  it('reads the size of a value', () => {
    expect(resolveSize(businessCards, 'square_2_5')).toEqual({ code: 'square_2_5', widthIn: 2.5, heightIn: 2.5, bleedIn: 0.125, safeIn: 0.125 });
  });

  it('refuses an unknown size', () => {
    expect(() => resolveSize(businessCards, 'custom')).toThrow('Unknown size "custom"');
  });
});
