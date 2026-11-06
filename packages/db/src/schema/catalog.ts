import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, id, timestamps } from './columns.js';

/** `code` is also the product's storefront URL, e.g. /premium-business-cards. */
export const products = pgTable('products', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  /** Shown under the name on the product page. */
  description: text('description'),
  /** Browser title and search result text; the name and description are used when empty. */
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  /** What customers call one and several of it on the storefront, e.g. "flyer" and "flyers". */
  unitName: text('unit_name').notNull().default('item'),
  unitNamePlural: text('unit_name_plural').notNull().default('items'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
  ...timestamps,
});

/** The option library: groups and options are created once and shared by every product. */
export const optionGroups = pgTable(
  'option_groups',
  {
    id: id(),
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
    unique('option_groups_code_key').on(t.code),
    check('option_groups_display_style_check', sql`${t.displayStyle} in ('dropdown', 'radio', 'swatch')`),
  ],
);

/**
 * attributes depend on the group:
 *   size:        { trim_w_in, trim_h_in, bleed_in, safe_in }
 *   paper:       { thickness_pt, tier }
 *   coating:     { front, back, laminated }
 *   turnaround:  {} (days and price per quantity live in turnaround_options)
 * A product uses an option through product_option_values.
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
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [unique('option_values_group_code_key').on(t.groupId, t.code)],
);

/**
 * The library options a product uses, with what is its own: hidden or not, its default in the group,
 * and for add-ons the percent of the core price. Core options are priced in core_prices and turnaround
 * in turnaround_options, so addon_percent stays 0 for them.
 */
export const productOptionValues = pgTable(
  'product_option_values',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    valueId: uuid('value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    addonPercent: numeric('addon_percent', { precision: 6, scale: 2, mode: 'number' }).notNull().default(0),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.valueId] }),
    uniqueIndex('product_option_values_one_default_per_group').on(t.productId, t.groupId).where(sql`${t.isDefault}`),
    check('product_option_values_addon_percent_check', sql`${t.addonPercent} between -90 and 500`),
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
  (t) => [unique('option_value_rules_product_when_target_key').on(t.productId, t.whenValueId, t.targetGroupId)],
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

/** The quantities of the option library. Changing a number here changes it on every product using it. */
export const libraryQuantities = pgTable(
  'library_quantities',
  {
    quantity: integer('quantity').primaryKey(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [check('library_quantities_quantity_check', sql`${t.quantity} > 0`)],
);

/** The library quantities a product sells; its prices and turnaround hang on these rows. */
export const productQuantityTiers = pgTable(
  'product_quantity_tiers',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity')
      .notNull()
      .references(() => libraryQuantities.quantity, { onDelete: 'restrict', onUpdate: 'cascade' }),
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
  ],
);

/**
 * Set price of a combination of the core options (size, paper, printed sides) at a quantity.
 * No row = that combination is not sold at that quantity.
 */
export const corePrices = pgTable(
  'core_prices',
  {
    sizeValueId: uuid('size_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    paperValueId: uuid('paper_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    printedSideValueId: uuid('printed_side_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    quantityTierId: uuid('quantity_tier_id')
      .notNull()
      .references(() => productQuantityTiers.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents').notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: 'core_prices_pk', columns: [t.sizeValueId, t.paperValueId, t.printedSideValueId, t.quantityTierId] }),
    check('core_prices_price_check', sql`${t.priceCents} > 0`),
  ],
);

/**
 * Quantity × speed table of a product's turnaround group: production days and a percent added to the
 * printing price (negative for a discount). No row = that speed is not offered at that quantity.
 */
export const turnaroundOptions = pgTable(
  'turnaround_options',
  {
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => optionValues.id, { onDelete: 'cascade' }),
    quantityTierId: uuid('quantity_tier_id')
      .notNull()
      .references(() => productQuantityTiers.id, { onDelete: 'cascade' }),
    businessDays: integer('business_days').notNull(),
    pricePercent: numeric('price_percent', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.optionValueId, t.quantityTierId] }),
    check('turnaround_options_days_check', sql`${t.businessDays} between 1 and 60`),
    check('turnaround_options_percent_check', sql`${t.pricePercent} between -90 and 500`),
  ],
);
