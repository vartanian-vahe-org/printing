import { describe, expect, it } from 'vitest';
import { formatDelta } from '../lib/format';

describe('formatDelta', () => {
  it('shows extra costs without a plus sign', () => {
    expect(formatDelta(175)).toBe('$1.75');
  });

  it('shows discounts as savings, never with a minus sign', () => {
    expect(formatDelta(-250)).toBe('Save $2.50');
  });

  it('shows nothing for no difference', () => {
    expect(formatDelta(0)).toBe('');
  });
});
