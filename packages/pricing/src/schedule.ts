/**
 * Ship and delivery dates (docs/specs/business-card-mvp.md §5), shared by the storefront (live
 * estimates) and the API (dates stored on orders).
 *
 * 1. Start day: today if it is a working day and before the cutoff (2 PM Pacific), else the next working day.
 * 2. Ship day: start day + (turnaround business days − 1) working days.
 * 3. Delivery: ship day + the shipping method's transit days, counted on carrier days (Mon–Fri, no holidays).
 *
 * Dates are calendar dates in the shop's time zone, as 'YYYY-MM-DD' strings.
 */
import type { Catalog } from './types.js';

export const TURNAROUND_GROUP = 'turnaround';

/** Shop calendar, from production_settings + holidays. */
export interface ProductionCalendar {
  /** IANA zone of the shop, e.g. 'America/Los_Angeles'. */
  timezone: string;
  /** Local cutoff 'HH:MM' (seconds ignored). Orders after it start the next working day. */
  cutoffTime: string;
  /** ISO weekdays the shop prints: 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  /** Closed days 'YYYY-MM-DD'; carriers do not deliver on them either. */
  holidays: string[];
}

export interface ProductionSchedule {
  /** Day production starts. */
  startDate: string;
  /** Day the order leaves the shop. */
  shipDate: string;
  /** Order before this instant (ISO, the cutoff on the start day) to get this schedule. */
  orderBy: string;
}

export interface DeliveryWindow {
  from: string;
  to: string;
}

/** Carriers deliver Monday to Friday. */
const CARRIER_DAYS = [1, 2, 3, 4, 5];

function parts(instant: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)) {
    if (p.type !== 'literal') values[p.type] = Number(p.value);
  }
  return values as { year: number; month: number; day: number; hour: number; minute: number };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date and minutes after midnight of `instant` in `timeZone`. */
export function localDateTime(instant: Date, timeZone: string): { date: string; minutes: number } {
  const p = parts(instant, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, minutes: p.hour * 60 + p.minute };
}

/** The instant when the clock in `timeZone` shows `date` `time` (handles daylight saving). */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  // Two passes: the offset can differ on either side of a DST change.
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function addCalendarDays(date: string, days: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** ISO weekday of a 'YYYY-MM-DD' date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function isOpen(date: string, days: number[], holidays: ReadonlySet<string>): boolean {
  return days.includes(isoWeekday(date)) && !holidays.has(date);
}

/** The `count`-th open day after `date` (`date` itself not counted); `date` when count is 0. */
export function addOpenDays(date: string, count: number, days: number[], holidays: ReadonlySet<string>): string {
  if (days.length === 0) throw new Error('No working days configured');
  let current = date;
  for (let left = count; left > 0; ) {
    current = addCalendarDays(current, 1);
    if (isOpen(current, days, holidays)) left--;
  }
  return current;
}

export function productionSchedule(now: Date, businessDays: number, calendar: ProductionCalendar): ProductionSchedule {
  const holidays = new Set(calendar.holidays);
  const { date, minutes } = localDateTime(now, calendar.timezone);
  const [ch, cm] = calendar.cutoffTime.split(':').map(Number) as [number, number];
  const beforeCutoff = minutes < ch * 60 + cm;

  const startDate =
    isOpen(date, calendar.workingDays, holidays) && beforeCutoff ? date : addOpenDays(date, 1, calendar.workingDays, holidays);
  const shipDate = addOpenDays(startDate, Math.max(1, businessDays) - 1, calendar.workingDays, holidays);
  const orderBy = zonedTimeToInstant(startDate, calendar.cutoffTime, calendar.timezone);
  return { startDate, shipDate, orderBy: orderBy.toISOString() };
}

export function deliveryWindow(shipDate: string, transitDaysMin: number, transitDaysMax: number, calendar: Pick<ProductionCalendar, 'holidays'>): DeliveryWindow {
  const holidays = new Set(calendar.holidays);
  return {
    from: addOpenDays(shipDate, transitDaysMin, CARRIER_DAYS, holidays),
    to: addOpenDays(shipDate, transitDaysMax, CARRIER_DAYS, holidays),
  };
}

/** Production days of the selected turnaround (its `business_days` attribute), or null if unknown. */
export function turnaroundDays(catalog: Catalog, selection: Record<string, string>): number | null {
  const value = catalog.groups
    .find((g) => g.code === TURNAROUND_GROUP)
    ?.values.find((v) => v.code === selection[TURNAROUND_GROUP]);
  const days = value?.attributes.business_days;
  return typeof days === 'number' && days > 0 ? days : null;
}

/** Latest ship date of several items: the order ships when everything is printed. */
export function latestDate(dates: string[]): string | null {
  return dates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null);
}
