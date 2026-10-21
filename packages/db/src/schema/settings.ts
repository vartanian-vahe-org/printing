import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, pgTable, smallint, text, time, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditColumns, id, timestamps } from './columns.js';

/** Single-row table (id is always 1). */
export const productionSettings = pgTable(
  'production_settings',
  {
    id: smallint('id').primaryKey().default(1),
    timezone: text('timezone').notNull(),
    cutoffTime: time('cutoff_time').notNull(),
    /** ISO weekdays: 1 = Monday ... 7 = Sunday */
    workingDays: smallint('working_days').array().notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [check('production_settings_single_row', sql`${t.id} = 1`)],
);

/** Single-row table (id is always 1): shop identity used in emails and on the site. */
export const storeSettings = pgTable(
  'store_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /** Shown in emails ("Print Studio <orders@...>"). Placeholder until the brand is chosen (open issue U1). */
    storeName: text('store_name').notNull(),
    /** Reply-to address on customer emails. */
    supportEmail: text('support_email').notNull(),
    /** Staff addresses told about every new order. */
    orderNotificationEmails: text('order_notification_emails').array().notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [check('store_settings_single_row', sql`${t.id} = 1`)],
);

export const holidays = pgTable('holidays', {
  id: id(),
  date: date('date').notNull().unique(),
  name: text('name').notNull(),
  ...auditColumns,
  ...timestamps,
});

export const shippingMethods = pgTable(
  'shipping_methods',
  {
    id: id(),
    code: text('code').notNull().unique(),
    label: text('label').notNull(),
    transitDaysMin: integer('transit_days_min').notNull(),
    transitDaysMax: integer('transit_days_max').notNull(),
    priceCents: integer('price_cents').notNull(),
    /** Order subtotal at or above which this method is free. Null = never free. */
    freeOverCents: integer('free_over_cents'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('shipping_methods_one_default').on(t.isDefault).where(sql`${t.isDefault}`),
    check('shipping_methods_transit_check', sql`${t.transitDaysMin} > 0 and ${t.transitDaysMax} >= ${t.transitDaysMin}`),
    check('shipping_methods_price_check', sql`${t.priceCents} >= 0`),
  ],
);
