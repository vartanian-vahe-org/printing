import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { products } from './catalog.js';
import { auditColumns, id, timestamps } from './columns.js';

/**
 * "Let us design it for you" packages (e.g. Standard, Premium, Elite), priced per product: a design
 * for business cards costs less than one for a brochure. The fee is charged once per cart item.
 */
export const designServiceTiers = pgTable(
  'design_service_tiers',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceCents: integer('price_cents').notNull(),
    /** What the package includes, one line each (shown as a list). */
    features: jsonb('features').$type<string[]>().notNull().default([]),
    /** Business days until the first draft. */
    designDays: integer('design_days').notNull(),
    /** Rounds of changes included; null = unlimited. */
    revisions: integer('revisions'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    unique('design_service_tiers_product_code_key').on(t.productId, t.code),
    check('design_service_tiers_price_check', sql`${t.priceCents} >= 0`),
    check('design_service_tiers_days_check', sql`${t.designDays} between 1 and 60`),
    check('design_service_tiers_revisions_check', sql`${t.revisions} is null or ${t.revisions} >= 0`),
  ],
);
