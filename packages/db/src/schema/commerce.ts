import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, id, timestamps } from './columns.js';

/**
 * Sales tax rate per US state for the default tax provider (decision T14).
 * Placeholder until a tax service is chosen (docs/open-issues.md S7).
 */
export const taxRates = pgTable(
  'tax_rates',
  {
    id: id(),
    state: text('state').notNull(),
    /** Basis points: 725 = 7.25%. */
    rateBps: integer('rate_bps').notNull(),
    label: text('label').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tax_rates_state_key').on(t.state),
    check('tax_rates_state_check', sql`${t.state} ~ '^[A-Z]{2}$'`),
    check('tax_rates_rate_check', sql`${t.rateBps} between 0 and 2000`),
  ],
);

/** Shopping cart. Guests are identified by a cookie whose token is stored hashed. */
export const carts = pgTable(
  'carts',
  {
    id: id(),
    tokenHash: text('token_hash').notNull(),
    /** Set once customer accounts exist (Phase 2 step 10). */
    customerId: uuid('customer_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('carts_token_hash_key').on(t.tokenHash), index('carts_customer_idx').on(t.customerId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: id(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productCode: text('product_code').notNull(),
    /** { selection, quantity, customSize? } as accepted by POST /quotes. */
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull(),
    /** { mode: 'template' | 'upload', templateCode?, values?, files? } */
    design: jsonb('design').$type<Record<string, unknown>>().notNull(),
    /** Price when added; the server prices again at checkout. */
    totalCents: integer('total_cents').notNull(),
    ...timestamps,
  },
  (t) => [index('cart_items_cart_idx').on(t.cartId)],
);

export const ORDER_STATUSES = ['placed', 'in_production', 'shipped', 'completed', 'cancelled'] as const;
export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;

export const orders = pgTable(
  'orders',
  {
    id: id(),
    /** Customer-facing order number, e.g. #100001. */
    number: integer('number').notNull().generatedAlwaysAsIdentity({ startWith: 100001 }),
    email: text('email').notNull(),
    customerId: uuid('customer_id'),
    status: text('status').notNull().default('placed'),
    paymentStatus: text('payment_status').notNull().default('unpaid'),
    /** { name, company?, line1, line2?, city, state, zip, phone? } */
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>().notNull(),
    /** Snapshot of the chosen method: { code, label, priceCents, transitDaysMin, transitDaysMax } */
    shippingMethod: jsonb('shipping_method').$type<Record<string, unknown>>().notNull(),
    /** Snapshot of the tax applied: { provider, state, rateBps, label } */
    tax: jsonb('tax').$type<Record<string, unknown>>().notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    taxCents: integer('tax_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    /**
     * Estimated ship day and delivery window (shop calendar dates). Set at checkout as if production
     * started now; recalculated when payment is recorded (production can only start then).
     */
    shipBy: date('ship_by'),
    deliverFrom: date('deliver_from'),
    deliverTo: date('deliver_to'),
    /** Hash of the secret in the "track your order" link sent by email. */
    accessTokenHash: text('access_token_hash').notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_number_key').on(t.number),
    uniqueIndex('orders_access_token_hash_key').on(t.accessTokenHash),
    index('orders_email_idx').on(sql`lower(${t.email})`),
    index('orders_status_idx').on(t.status),
    index('orders_ship_by_idx').on(t.shipBy),
    index('orders_customer_idx').on(t.customerId),
    check('orders_status_check', sql`${t.status} in ('placed', 'in_production', 'shipped', 'completed', 'cancelled')`),
    check('orders_payment_status_check', sql`${t.paymentStatus} in ('unpaid', 'paid', 'refunded')`),
    check(
      'orders_total_check',
      sql`${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents} + ${t.taxCents} and ${t.totalCents} >= 0`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productCode: text('product_code').notNull(),
    productName: text('product_name').notNull(),
    configuration: jsonb('configuration').$type<Record<string, unknown>>().notNull(),
    design: jsonb('design').$type<Record<string, unknown>>().notNull(),
    /** Full price breakdown at order time (Quote from @printing/pricing). */
    quote: jsonb('quote').$type<Record<string, unknown>>().notNull(),
    /**
     * What the print file needs, frozen at order time so later catalog or template edits do not
     * change it: { version, geometry, backMode, template?: { code, name, layout } }.
     */
    printSpec: jsonb('print_spec').$type<Record<string, unknown>>(),
    quantity: integer('quantity').notNull(),
    totalCents: integer('total_cents').notNull(),
    /**
     * pending: file check not done yet · awaiting_design: our designer is making the design (design
     * service) · awaiting_customer: proof ready to approve · needs_new_file: the check found errors,
     * the customer must upload again · approved.
     */
    proofStatus: text('proof_status').notNull().default('pending'),
    /** Result of the last file check: { checkedAt, issues: [{ code, level, message, page? }], proofs: [{ page, key }] }. */
    preflight: jsonb('preflight').$type<Record<string, unknown>>(),
    /** Storage key of the print file the check and proof were made from. */
    printKey: text('print_key'),
    proofApprovedAt: timestamp('proof_approved_at', { withTimezone: true }),
    /** Who approved: 'customer' or a staff user id (approval taken by phone or email). */
    proofApprovedBy: text('proof_approved_by'),
    productionStatus: text('production_status').notNull().default('waiting'),
    ...timestamps,
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    check('order_items_proof_status_check', sql`${t.proofStatus} in ('pending', 'awaiting_design', 'awaiting_customer', 'needs_new_file', 'approved')`),
    check(
      'order_items_production_status_check',
      sql`${t.productionStatus} in ('waiting', 'in_production', 'printed', 'shipped')`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** 'manual' until a payment provider is chosen (docs/open-issues.md S6). */
    provider: text('provider').notNull(),
    status: text('status').notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** Provider reference, or a note for manual payments (e.g. "Zelle 10/21"). */
    reference: text('reference'),
    recordedBy: text('recorded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    check('payments_status_check', sql`${t.status} in ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')`),
  ],
);

export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrier: text('carrier').notNull(),
    service: text('service'),
    trackingNumber: text('tracking_number').notNull(),
    shippedAt: timestamp('shipped_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shipments_order_idx').on(t.orderId)],
);

/**
 * Order history shown in the admin: placed, payment recorded, status changes, emails sent, notes.
 * `createdBy` is a staff user id, 'customer' or 'system'.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);
