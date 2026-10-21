import { boolean, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { products } from './catalog.js';
import { auditColumns, id, timestamps } from './columns.js';

/**
 * Card design templates. The layout JSON format is defined together with the
 * JSON -> SVG renderer (Phase 1 step 7).
 */
export const templates = pgTable(
  'templates',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /** Size option codes this template supports, e.g. {std_3_5x2, square_2_5}. */
    supportedSizeCodes: text('supported_size_codes').array().notNull(),
    layout: jsonb('layout').$type<Record<string, unknown>>().notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [unique('templates_product_code_key').on(t.productId, t.code)],
);
