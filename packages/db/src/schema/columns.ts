import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Who created/changed a row: a staff user id, or 'system:migration' for seeded defaults. */
export const auditColumns = {
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
};
