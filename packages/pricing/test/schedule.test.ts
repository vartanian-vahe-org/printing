import { describe, expect, it } from 'vitest';
import {
  deliveryWindow,
  isoWeekday,
  latestDate,
  localDateTime,
  productionSchedule,
  zonedTimeToInstant,
  type ProductionCalendar,
} from '../src/schedule.js';

const calendar: ProductionCalendar = {
  timezone: 'America/Los_Angeles',
  cutoffTime: '14:00:00',
  workingDays: [1, 2, 3, 4, 5],
  holidays: ['2026-11-11', '2026-11-26', '2026-12-25'],
};

/** Instant for a Pacific wall-clock time. */
const pacific = (date: string, time: string) => zonedTimeToInstant(date, time, 'America/Los_Angeles');

describe('time zone helpers', () => {
  it('reads the Pacific date and time of an instant, across daylight saving', () => {
    expect(localDateTime(new Date('2026-10-21T20:59:00Z'), 'America/Los_Angeles')).toEqual({ date: '2026-10-21', minutes: 13 * 60 + 59 });
    expect(localDateTime(new Date('2026-12-01T22:00:00Z'), 'America/Los_Angeles')).toEqual({ date: '2026-12-01', minutes: 14 * 60 });
  });

  it('converts a Pacific wall-clock time to an instant (PDT and PST)', () => {
    expect(pacific('2026-10-21', '14:00').toISOString()).toBe('2026-10-21T21:00:00.000Z');
    expect(pacific('2026-12-01', '14:00').toISOString()).toBe('2026-12-01T22:00:00.000Z');
  });

  it('knows ISO weekdays', () => {
    expect(isoWeekday('2026-10-21')).toBe(3);
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
});

describe('productionSchedule', () => {
  it('starts today before the 2 PM cutoff', () => {
    // Wednesday 1:59 PM, 3 business days: Wed, Thu, Fri.
    expect(productionSchedule(pacific('2026-10-21', '13:59'), 3, calendar)).toEqual({
      startDate: '2026-10-21',
      shipDate: '2026-10-23',
      orderBy: '2026-10-21T21:00:00.000Z',
    });
  });

  it('starts the next working day at or after the cutoff, skipping the weekend', () => {
    // Wednesday 2:00 PM → starts Thursday; 3 days: Thu, Fri, Mon.
    expect(productionSchedule(pacific('2026-10-21', '14:00'), 3, calendar)).toMatchObject({ startDate: '2026-10-22', shipDate: '2026-10-26' });
  });

  it('ships the same day for 1-day turnaround', () => {
    expect(productionSchedule(pacific('2026-10-21', '09:00'), 1, calendar).shipDate).toBe('2026-10-21');
  });

  it('moves weekend orders to Monday', () => {
    expect(productionSchedule(pacific('2026-10-24', '10:00'), 1, calendar)).toMatchObject({
      startDate: '2026-10-26',
      shipDate: '2026-10-26',
      orderBy: '2026-10-26T21:00:00.000Z',
    });
  });

  it('skips holidays (Veterans Day, Thanksgiving)', () => {
    // Tuesday Nov 10 after cutoff → Wed Nov 11 is a holiday → starts Thu Nov 12.
    expect(productionSchedule(pacific('2026-11-10', '15:00'), 2, calendar)).toMatchObject({ startDate: '2026-11-12', shipDate: '2026-11-13' });
    // Wednesday Nov 25, 5 days: Wed, (Thu holiday), Fri, Mon, Tue, Wed.
    expect(productionSchedule(pacific('2026-11-25', '08:00'), 5, calendar).shipDate).toBe('2026-12-02');
  });

  it('uses the cutoff in standard time after the clocks change', () => {
    expect(productionSchedule(pacific('2026-12-01', '13:30'), 1, calendar).orderBy).toBe('2026-12-01T22:00:00.000Z');
  });
});

describe('deliveryWindow', () => {
  it('counts transit on weekdays after the ship date', () => {
    // Ships Friday Oct 23; 3–5 days: Wed Oct 28 – Fri Oct 30.
    expect(deliveryWindow('2026-10-23', 3, 5, calendar)).toEqual({ from: '2026-10-28', to: '2026-10-30' });
    // Overnight from Friday arrives Monday.
    expect(deliveryWindow('2026-10-23', 1, 1, calendar)).toEqual({ from: '2026-10-26', to: '2026-10-26' });
  });

  it('skips holidays in transit', () => {
    expect(deliveryWindow('2026-12-24', 1, 2, calendar)).toEqual({ from: '2026-12-28', to: '2026-12-29' });
  });
});

describe('latestDate', () => {
  it('picks the latest ship date', () => {
    expect(latestDate(['2026-10-23', '2026-10-26', '2026-10-22'])).toBe('2026-10-26');
    expect(latestDate([])).toBeNull();
  });
});
