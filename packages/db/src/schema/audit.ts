import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns.js';
import { staffUsers } from './staff.js';

/**
 * Who changed what in the admin (open issue A1): catalog, prices, rules, templates, staff accounts
 * and settings. Order actions have their own history in order_events.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    staffUserId: uuid('staff_user_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    /** Name and email at the time, kept if the account is deleted later. */
    actor: text('actor').notNull(),
    /** Dotted action code, e.g. 'catalog.value.update', 'staff.create', 'settings.store.update'. */
    action: text('action').notNull(),
    /** What was changed, readable: 'paper / 16pt', 'jamie@shop.com'. */
    target: text('target').notNull(),
    summary: text('summary').notNull(),
    /** { before, after } (never passwords). */
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_action_idx').on(t.action)],
);
