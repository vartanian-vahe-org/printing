import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, timestamps } from './columns.js';

export const products = pgTable('products', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
  ...timestamps,
});

export const optionGroups = pgTable(
  'option_groups',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    displayStyle: text('display_style').notNull().default('dropdown'),
    isRequired: boolean('is_required').notNull().default(true),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    unique('option_groups_product_code_key').on(t.productId, t.code),
    check('option_groups_display_style_check', sql`${t.displayStyle} in ('dropdown', 'radio', 'swatch')`),
  ],
);

/**
 * attributes depend on the group:
 *   size preset: { trim_w_in, trim_h_in, bleed_in, safe_in, price_multiplier }
 *   size custom: { min_in, max_in, step_in, bleed_in, safe_in, fit_box: { w_in, h_in }, fit_multiplier, area_multiplier }
 *   paper:       { thickness_pt, tier }
 *   coating:     { front, back, laminated }
 *   turnaround:  { business_days }
 */
export const optionValues = pgTable(
  'option_values',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    unique('option_values_group_code_key').on(t.groupId, t.code),
    uniqueIndex('option_values_one_default_per_group').on(t.groupId).where(sql`${t.isDefault}`),
  ],
);

/** "When value X is selected, group Y may only use the values listed in option_value_rule_allowed." */
export const optionValueRules = pgTable(
  'option_value_rules',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    whenValueId: uuid('when_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    targetGroupId: uuid('target_group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [unique('option_value_rules_when_target_key').on(t.whenValueId, t.targetGroupId)],
);

export const optionValueRuleAllowed = pgTable(
  'option_value_rule_allowed',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => optionValueRules.id, { onDelete: 'cascade' }),
    valueId: uuid('value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.valueId] })],
);

export const productQuantityTiers = pgTable(
  'product_quantity_tiers',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    basePriceCents: integer('base_price_cents').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    unique('product_quantity_tiers_product_quantity_key').on(t.productId, t.quantity),
    uniqueIndex('product_quantity_tiers_one_default_per_product').on(t.productId).where(sql`${t.isDefault}`),
    check('product_quantity_tiers_quantity_check', sql`${t.quantity} > 0`),
    check('product_quantity_tiers_base_price_check', sql`${t.basePriceCents} >= 0`),
  ],
);

/** Upcharge of one option value at one quantity tier. May be negative. */
export const optionValuePrices = pgTable(
  'option_value_prices',
  {
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    quantityTierId: uuid('quantity_tier_id')
      .notNull()
      .references(() => productQuantityTiers.id, { onDelete: 'cascade' }),
    upchargeCents: integer('upcharge_cents').notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.optionValueId, t.quantityTierId] })],
);
