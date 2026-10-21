import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    /** Two-step sign-in (TOTP, open issue A8): secret encrypted with DATA_ENCRYPTION_KEY; null when off. */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    createdBy: text('created_by'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('staff_users_email_key').on(sql`lower(${t.email})`),
    check('staff_users_role_check', sql`${t.role} in ('owner', 'admin', 'staff')`),
  ],
);

/**
 * Admin login sessions. Only a SHA-256 hash of the session token is stored, so a database
 * leak does not expose usable cookies.
 */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('staff_sessions_token_hash_key').on(t.tokenHash), index('staff_sessions_staff_user_idx').on(t.staffUserId)],
);

/** One-time password reset links for staff (open issue A7). Only a hash is stored; short-lived. */
export const staffPasswordResets = pgTable(
  'staff_password_resets',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('staff_password_resets_token_hash_key').on(t.tokenHash), index('staff_password_resets_staff_idx').on(t.staffUserId)],
);
