import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns.js';

export const staffUsers = pgTable(
  'staff_users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('admin'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdBy: text('created_by'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('staff_users_email_key').on(sql`lower(${t.email})`),
    check('staff_users_role_check', sql`${t.role} in ('owner', 'admin', 'staff')`),
  ],
);
