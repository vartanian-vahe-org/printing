import { zonedTimeToInstant } from '@printing/pricing';
import { describe, expect, it } from 'vitest';
import { formatDateRange, formatShopDate, orderByText } from '../lib/schedule-text.js';

const tz = 'America/Los_Angeles';
const at = (date: string, time: string) => zonedTimeToInstant(date, time, tz);

describe('schedule text', () => {
  it('formats shop dates and ranges', () => {
    expect(formatShopDate('2026-10-23')).toBe('Fri, Oct 23');
    expect(formatDateRange('2026-10-28', '2026-10-30')).toBe('Wed, Oct 28 – Fri, Oct 30');
    expect(formatDateRange('2026-10-26', '2026-10-26')).toBe('Mon, Oct 26');
  });

  it('says today, tomorrow or the date of the cutoff, in shop time', () => {
    const cutoffWed = at('2026-10-21', '14:00').toISOString();
    expect(orderByText(cutoffWed, tz, at('2026-10-21', '09:00'))).toBe('2:00 PM PT today');
    expect(orderByText(at('2026-10-22', '14:00').toISOString(), tz, at('2026-10-21', '15:00'))).toBe('2:00 PM PT tomorrow');
    expect(orderByText(at('2026-10-26', '14:00').toISOString(), tz, at('2026-10-23', '15:00'))).toBe('2:00 PM PT Mon, Oct 26');
  });
});
