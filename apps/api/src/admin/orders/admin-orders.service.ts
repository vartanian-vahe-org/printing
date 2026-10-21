import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderEvents, orderItems, orders, payments, shipments, staffUsers, templates, type Database } from '@printing/db';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';
import { OrderScheduleService } from '../../orders/order-schedule.service.js';
import { OrderEmailQueue, type OrderEmailKind } from '../../orders/order-email.queue.js';
import { orderUrl } from '../../orders/order-link.js';
import { allowedActions, refusal, type OrderAction, type OrderListView } from '../../orders/order-workflow.js';
import { OrdersService, proofProgress, type OrderDetails } from '../../orders/orders.service.js';
import { StorageService } from '../../storage/storage.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type OrderRow = typeof orders.$inferSelect;

const PAGE_SIZE = 25;
const DOWNLOAD_LINK_SECONDS = 15 * 60;

/** An item of the order still has a proof that is not approved. */
const proofOpen = sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.proofStatus} <> 'approved')`;

const VIEW_FILTERS: Record<OrderListView, SQL | undefined> = {
  needs_payment: and(eq(orders.paymentStatus, 'unpaid'), ne(orders.status, 'cancelled')),
  proof: and(eq(orders.status, 'placed'), proofOpen),
  ready: and(eq(orders.status, 'placed'), eq(orders.paymentStatus, 'paid'), sql`not ${proofOpen}`),
  printing: eq(orders.status, 'in_production'),
  shipped: inArray(orders.status, ['shipped', 'completed']),
  cancelled: eq(orders.status, 'cancelled'),
  all: undefined,
};

export interface AdminOrderListItem {
  number: number;
  placedAt: string;
  email: string;
  name: string;
  state: string;
  itemCount: number;
  totalCents: number;
  status: string;
  paymentStatus: string;
  shipBy: string | null;
}

export interface DesignFile {
  label: string;
  fileName: string;
  url: string;
}

export interface AdminOrderDetail extends Omit<OrderDetails, 'id' | 'items'> {
  items: (OrderDetails['items'][number] & { templateName: string | null; files: DesignFile[] })[];
  payments: { provider: string; status: string; amountCents: number; reference: string | null; recordedBy: string | null; createdAt: string }[];
  events: { type: string; message: string; by: string; createdAt: string }[];
  allowedActions: OrderAction[];
  /** The customer's private order page, to share by phone or chat if needed. */
  customerUrl: string;
}

/** Escapes LIKE wildcards in a search term. */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class AdminOrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly emails: OrderEmailQueue,
    private readonly storage: StorageService,
    private readonly schedule: OrderScheduleService,
  ) {}

  // ---------------------------------------------------------------- read

  async list(view: OrderListView, q: string | undefined, page: number) {
    const term = q?.trim();
    let search: SQL | undefined;
    if (term) {
      const number = /^#?\d{1,9}$/.test(term) ? Number(term.replace('#', '')) : null;
      search =
        number !== null
          ? eq(orders.number, number)
          : or(ilike(orders.email, likeTerm(term)), ilike(sql`${orders.shippingAddress}->>'name'`, likeTerm(term)));
    }
    const where = and(VIEW_FILTERS[view], search);

    const itemCount = this.db
      .select({ orderId: orderItems.orderId, n: count().as('n') })
      .from(orderItems)
      .groupBy(orderItems.orderId)
      .as('item_count');

    const [rows, [{ total } = { total: 0 }], counts] = await Promise.all([
      this.db
        .select({
          number: orders.number,
          placedAt: orders.placedAt,
          email: orders.email,
          name: sql<string>`${orders.shippingAddress}->>'name'`,
          state: sql<string>`${orders.shippingAddress}->>'state'`,
          itemCount: sql<number>`coalesce(${itemCount.n}, 0)::int`,
          totalCents: orders.totalCents,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          shipBy: orders.shipBy,
        })
        .from(orders)
        .leftJoin(itemCount, eq(itemCount.orderId, orders.id))
        .where(where)
        // Work queues by deadline; everything else newest first.
        .orderBy(...(view === 'ready' || view === 'printing' ? [sql`${orders.shipBy} asc nulls last`, asc(orders.placedAt)] : [desc(orders.placedAt)]))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      this.db.select({ total: count() }).from(orders).where(where),
      this.viewCounts(search),
    ]);

    return {
      orders: rows.map((r): AdminOrderListItem => ({ ...r, placedAt: r.placedAt.toISOString() })),
      total,
      page,
      pageSize: PAGE_SIZE,
      counts,
    };
  }

  /** Orders per tab, for the badges (search applied, tab filter not). */
  private async viewCounts(search: SQL | undefined): Promise<Record<OrderListView, number>> {
    const filtered = (view: OrderListView) => sql<number>`count(*) filter (where ${VIEW_FILTERS[view] ?? sql`true`})::int`;
    const [row] = await this.db
      .select({
        needs_payment: filtered('needs_payment'),
        proof: filtered('proof'),
        ready: filtered('ready'),
        printing: filtered('printing'),
        shipped: filtered('shipped'),
        cancelled: filtered('cancelled'),
        all: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(search);
    return row!;
  }

  async detail(number: number): Promise<AdminOrderDetail> {
    const order = await this.orders.byNumber(number);
    if (!order) throw new NotFoundException(`Order #${number} not found`);

    const [paymentRows, eventRows, templateRows] = await Promise.all([
      this.db
        .select({
          provider: payments.provider,
          status: payments.status,
          amountCents: payments.amountCents,
          reference: payments.reference,
          recordedBy: staffUsers.name,
          createdAt: payments.createdAt,
        })
        .from(payments)
        // recorded_by / created_by hold a staff id as text, or 'customer' / 'system'.
        .leftJoin(staffUsers, sql`${staffUsers.id}::text = ${payments.recordedBy}`)
        .where(eq(payments.orderId, order.id))
        .orderBy(asc(payments.createdAt)),
      this.db
        .select({
          type: orderEvents.type,
          message: orderEvents.message,
          createdBy: orderEvents.createdBy,
          staffName: staffUsers.name,
          createdAt: orderEvents.createdAt,
        })
        .from(orderEvents)
        .leftJoin(staffUsers, sql`${staffUsers.id}::text = ${orderEvents.createdBy}`)
        .where(eq(orderEvents.orderId, order.id))
        .orderBy(desc(orderEvents.createdAt)),
      this.db.select({ code: templates.code, name: templates.name }).from(templates),
    ]);
    const templateNames = new Map(templateRows.map((t) => [t.code, t.name]));

    const items = await Promise.all(
      order.items.map(async (item) => {
        const design = item.design as Record<string, any>;
        const files: DesignFile[] = [];
        const add = async (label: string, key: string | undefined, fileName: string) => {
          if (key) files.push({ label, fileName, url: await this.storage.presignGet(key, fileName, DOWNLOAD_LINK_SECONDS) });
        };
        if (design.mode === 'upload') {
          await add('Front PDF', design.front?.key, design.front?.fileName ?? 'front.pdf');
          await add('Back PDF', design.back?.key, design.back?.fileName ?? 'back.pdf');
        } else {
          const ext = String(design.logoKey ?? '').split('.').pop() ?? 'png';
          await add('Logo', design.logoKey, `order-${order.number}-logo.${ext}`);
        }
        return { ...item, templateName: design.mode === 'template' ? (templateNames.get(design.templateCode) ?? design.templateCode) : null, files };
      }),
    );

    const { id, ...view } = order;
    return {
      ...view,
      items,
      payments: paymentRows.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      events: eventRows.map((e) => ({
        type: e.type,
        message: e.message,
        by: e.staffName ?? (e.createdBy === 'customer' ? 'Customer' : e.createdBy === 'system' ? 'System' : e.createdBy),
        createdAt: e.createdAt.toISOString(),
      })),
      allowedActions: allowedActions(order),
      customerUrl: orderUrl(order.number, id),
    };
  }

  // ---------------------------------------------------------------- actions

  async recordPayment(number: number, input: { reference: string; notify: boolean }, staffId: string) {
    const order = await this.act(number, 'record_payment', staffId, async (tx, row) => {
      // Checkout left a pending manual payment; complete it rather than adding a second row.
      const completed = await tx
        .update(payments)
        // created_at becomes the time the payment was received, not when checkout opened it.
        .set({ status: 'succeeded', reference: input.reference, recordedBy: staffId, createdAt: new Date() })
        .where(and(eq(payments.orderId, row.id), eq(payments.provider, 'manual'), eq(payments.status, 'pending')))
        .returning({ id: payments.id });
      if (completed.length === 0) {
        await tx.insert(payments).values({
          orderId: row.id,
          provider: 'manual',
          status: 'succeeded',
          amountCents: row.totalCents,
          reference: input.reference,
          recordedBy: staffId,
        });
      }
      // Production can start only now, so the ship and delivery estimates move from here.
      const now = new Date();
      const dates = await this.schedule.datesFrom(tx, row, now);
      await tx.update(orders).set({ paymentStatus: 'paid', paidAt: now, ...(dates ?? {}) }).where(eq(orders.id, row.id));
      return `Payment recorded: ${input.reference}${dates ? ` · ships by ${dates.shipBy}` : ''}`;
    });
    if (input.notify) await this.emails.send('payment-received', order.id);
  }

  async startProduction(number: number, staffId: string) {
    await this.act(number, 'start_production', staffId, async (tx, row) => {
      await tx.update(orders).set({ status: 'in_production' }).where(eq(orders.id, row.id));
      await tx.update(orderItems).set({ productionStatus: 'in_production' }).where(eq(orderItems.orderId, row.id));
      return 'Moved to production';
    });
  }

  async addShipment(
    number: number,
    input: { carrier: string; service?: string; trackingNumber: string; notify: boolean },
    staffId: string,
  ) {
    const order = await this.act(number, 'add_shipment', staffId, async (tx, row) => {
      await tx.insert(shipments).values({
        orderId: row.id,
        carrier: input.carrier,
        service: input.service ?? null,
        trackingNumber: input.trackingNumber,
        createdBy: staffId,
      });
      if (row.status !== 'shipped') {
        await tx.update(orders).set({ status: 'shipped', shippedAt: new Date() }).where(eq(orders.id, row.id));
        await tx.update(orderItems).set({ productionStatus: 'shipped' }).where(eq(orderItems.orderId, row.id));
      }
      return `Shipped with ${input.carrier.toUpperCase()}${input.service ? ` ${input.service}` : ''}: ${input.trackingNumber}`;
    });
    if (input.notify) await this.emails.send('order-shipped', order.id);
  }

  async markDelivered(number: number, staffId: string) {
    await this.act(number, 'mark_delivered', staffId, async (tx, row) => {
      await tx.update(orders).set({ status: 'completed' }).where(eq(orders.id, row.id));
      return 'Marked delivered';
    });
  }

  async cancel(number: number, input: { reason?: string; notify: boolean }, staffId: string) {
    const order = await this.act(number, 'cancel', staffId, async (tx, row) => {
      await tx.update(orders).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(orders.id, row.id));
      // A payment still waiting (manual or online) will not be collected anymore.
      await tx
        .update(payments)
        .set({ status: 'cancelled' })
        .where(and(eq(payments.orderId, row.id), eq(payments.status, 'pending')));
      return `Cancelled${input.reason ? `: ${input.reason}` : ''}${row.paymentStatus === 'paid' ? ' (refund due)' : ''}`;
    });
    if (input.notify) await this.emails.send('order-cancelled', order.id, input.reason);
  }

  async recordRefund(number: number, input: { reference: string }, staffId: string) {
    await this.act(number, 'record_refund', staffId, async (tx, row) => {
      await tx.insert(payments).values({
        orderId: row.id,
        provider: 'manual',
        status: 'refunded',
        amountCents: row.totalCents,
        reference: input.reference,
        recordedBy: staffId,
      });
      await tx.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, row.id));
      return `Refund recorded: ${input.reference}`;
    });
  }

  async addNote(number: number, text: string, staffId: string) {
    await this.act(number, null, staffId, async () => `Note: ${text}`, 'note');
  }

  async resendEmail(number: number, kind: OrderEmailKind, staffId: string) {
    const order = await this.orders.byNumber(number);
    if (!order) throw new NotFoundException(`Order #${number} not found`);
    if (kind === 'order-cancelled' && order.status !== 'cancelled') throw new BadRequestException('This order is not cancelled');
    if (kind === 'order-shipped' && order.status !== 'shipped' && order.status !== 'completed') {
      throw new BadRequestException('This order has not shipped');
    }
    if (kind === 'payment-received' && order.paymentStatus !== 'paid') throw new BadRequestException('This order is not paid');
    await this.act(number, null, staffId, async () => `Asked to resend the ${kind.replace(/-/g, ' ')} email`, 'email_requested');
    await this.emails.send(kind, order.id);
  }

  /**
   * Locks the order, checks the workflow allows `action`, applies `change` and records it in the
   * order history, all in one transaction. Emails are queued by the caller after commit.
   */
  private async act(
    number: number,
    action: OrderAction | null,
    staffId: string,
    change: (tx: Tx, order: OrderRow) => Promise<string>,
    eventType: string = action ?? 'note',
  ): Promise<OrderRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(orders).where(eq(orders.number, number)).for('update');
      if (!row) throw new NotFoundException(`Order #${number} not found`);
      const proofs = await tx.select({ status: orderItems.proofStatus }).from(orderItems).where(eq(orderItems.orderId, row.id));
      const refused = action ? refusal({ ...row, proofStatus: proofProgress(proofs.map((p) => p.status)) }, action) : null;
      if (refused) throw new ConflictException(refused);
      const message = await change(tx, row);
      await tx.insert(orderEvents).values({ orderId: row.id, type: eventType, message, createdBy: staffId });
      return row;
    });
  }
}
