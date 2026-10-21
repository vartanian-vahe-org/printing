import { Inject, Injectable } from '@nestjs/common';
import { holidays, productionSettings, type Database } from '@printing/db';
import { addCalendarDays, localDateTime, type ProductionCalendar } from '@printing/pricing';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';

const CACHE_MS = 60_000;
/** Holidays sent with the calendar: enough for the longest turnaround plus transit. */
const HOLIDAY_WINDOW_DAYS = 120;

/**
 * Shop calendar (cutoff, working days, holidays) from production_settings + holidays.
 * Cached for a minute: it changes rarely and is read on every cart, checkout and configurator call.
 */
@Injectable()
export class ProductionCalendarService {
  private cached: { calendar: ProductionCalendar; at: number } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Call after editing production settings or holidays. */
  invalidate(): void {
    this.cached = null;
  }

  async calendar(): Promise<ProductionCalendar> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.calendar;

    const [settings] = await this.db.select().from(productionSettings).where(eq(productionSettings.id, 1)).limit(1);
    if (!settings) throw new Error('production_settings row is missing (migration 0004)');
    const today = localDateTime(new Date(), settings.timezone).date;
    const rows = await this.db
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, addCalendarDays(today, -1)), lte(holidays.date, addCalendarDays(today, HOLIDAY_WINDOW_DAYS))))
      .orderBy(asc(holidays.date));

    const calendar: ProductionCalendar = {
      timezone: settings.timezone,
      cutoffTime: settings.cutoffTime.slice(0, 5),
      workingDays: settings.workingDays,
      holidays: rows.map((r) => r.date),
    };
    this.cached = { calendar, at: Date.now() };
    return calendar;
  }
}
