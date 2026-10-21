import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { holidays, productionSettings, storeSettings, type Database } from '@printing/db';
import { asc, eq, gte } from 'drizzle-orm';
import { ProductionCalendarService } from '../../catalog/production-calendar.service.js';
import { DATABASE } from '../../database/database.tokens.js';
import { AuditService } from '../audit/audit.service.js';

export interface StoreSettingsInput {
  storeName: string;
  supportEmail: string;
  orderNotificationEmails: string[];
}

export interface CalendarInput {
  /** 'HH:MM' in the shop's time zone. */
  cutoffTime: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workingDays: number[];
}

/** Shop settings in the admin (open issue A5): store identity, production calendar, holidays. */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly calendars: ProductionCalendarService,
  ) {}

  async get() {
    const [[store], [production], holidayRows] = await Promise.all([
      this.db.select().from(storeSettings).where(eq(storeSettings.id, 1)),
      this.db.select().from(productionSettings).where(eq(productionSettings.id, 1)),
      // From the start of last year: enough history without growing forever.
      this.db
        .select({ date: holidays.date, name: holidays.name })
        .from(holidays)
        .where(gte(holidays.date, `${new Date().getUTCFullYear() - 1}-01-01`))
        .orderBy(asc(holidays.date)),
    ]);
    if (!store || !production) throw new NotFoundException('Settings rows are missing (migrations 0004 and 0011)');
    return {
      store: { storeName: store.storeName, supportEmail: store.supportEmail, orderNotificationEmails: store.orderNotificationEmails },
      calendar: { timezone: production.timezone, cutoffTime: production.cutoffTime.slice(0, 5), workingDays: production.workingDays },
      holidays: holidayRows,
    };
  }

  async updateStore(input: StoreSettingsInput, staffId: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(storeSettings).where(eq(storeSettings.id, 1)).for('update');
      await tx.update(storeSettings).set({ ...input, updatedBy: staffId }).where(eq(storeSettings.id, 1));
      await this.audit.record(
        tx,
        staffId,
        {
          action: 'settings.store.update',
          target: 'store settings',
          summary: 'Updated the store name and emails',
          changes: {
            before: before && { storeName: before.storeName, supportEmail: before.supportEmail, orderNotificationEmails: before.orderNotificationEmails },
            after: input,
          },
        },
        ip,
      );
    });
  }

  async updateCalendar(input: CalendarInput, staffId: string, ip?: string) {
    const workingDays = [...new Set(input.workingDays)].sort();
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(productionSettings).where(eq(productionSettings.id, 1)).for('update');
      await tx.update(productionSettings).set({ cutoffTime: input.cutoffTime, workingDays, updatedBy: staffId }).where(eq(productionSettings.id, 1));
      await this.audit.record(
        tx,
        staffId,
        {
          action: 'settings.calendar.update',
          target: 'production calendar',
          summary: `Cutoff ${input.cutoffTime}, working days ${workingDays.join(',')}`,
          changes: { before: before && { cutoffTime: before.cutoffTime.slice(0, 5), workingDays: before.workingDays }, after: { cutoffTime: input.cutoffTime, workingDays } },
        },
        ip,
      );
    });
    this.calendars.invalidate();
  }

  async addHoliday(date: string, name: string, staffId: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ date: holidays.date }).from(holidays).where(eq(holidays.date, date));
      if (existing) throw new ConflictException(`${date} is already a holiday`);
      await tx.insert(holidays).values({ date, name, createdBy: staffId, updatedBy: staffId });
      await this.audit.record(tx, staffId, { action: 'settings.holiday.add', target: date, summary: `Added holiday ${name} (${date})` }, ip);
    });
    this.calendars.invalidate();
  }

  async removeHoliday(date: string, staffId: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx.delete(holidays).where(eq(holidays.date, date)).returning({ name: holidays.name });
      if (!removed) throw new NotFoundException(`${date} is not a holiday`);
      await this.audit.record(tx, staffId, { action: 'settings.holiday.remove', target: date, summary: `Removed holiday ${removed.name} (${date})` }, ip);
    });
    this.calendars.invalidate();
  }
}
