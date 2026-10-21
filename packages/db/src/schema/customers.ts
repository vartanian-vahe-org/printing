import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns.js';

/**
 * Customer accounts (Phase 2 step 10). Guests can still order without one. Orders placed with the
 * same email join the account only after the email is verified (spec §6.1).
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('customers_email_key').on(sql`lower(${t.email})`)],
);

/** Customer sign-in sessions; only a hash of the cookie token is stored. */
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_sessions_token_hash_key').on(t.tokenHash), index('customer_sessions_customer_idx').on(t.customerId)],
);

/** One-time links sent by email: verify the address, reset the password. Hash only, short-lived. */
export const customerTokens = pgTable(
  'customer_tokens',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_tokens_token_hash_key').on(t.tokenHash), check('customer_tokens_purpose_check', sql`${t.purpose} in ('verify_email', 'reset_password')`)],
);
