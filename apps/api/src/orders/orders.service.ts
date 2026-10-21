import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderItems, orders, payments, shipments, type Database } from '@printing/db';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { PAYMENT_PROVIDER, type PaymentProvider, type ShippingAddress } from '../commerce/ports.js';
import { DATABASE } from '../database/database.tokens.js';
import { StorageService } from '../storage/storage.service.js';
import type { PreflightRecord, ProofIssue } from './prepress.service.js';
import { hashOrderToken } from './order-link.js';
import { trackingUrl } from './tracking.js';

export type ProofProgress = 'pending' | 'awaiting_customer' | 'needs_new_file' | 'approved';

export interface OrderView {
  number: number;
  status: string;
  paymentStatus: string;
  /** Proof state over all items: approved only when every item is. */
  proofStatus: ProofProgress;
  email: string;
  placedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  cancelledAt: string | null;
  /** Estimated ship day and delivery window (shop calendar dates); null on orders from before step 9. */
  shipBy: string | null;
  deliverFrom: string | null;
  deliverTo: string | null;
  shippingAddress: ShippingAddress;
  shippingMethod: { label: string; priceCents: number; transitDaysMin: number; transitDaysMax: number };
  tax: { label: string; rateBps: number };
  items: {
    /** 1-based position, used in item URLs. */
    number: number;
    productName: string;
    summary: { label: string; value: string }[];
    design: Record<string, unknown>;
    quantity: number;
    totalCents: number;
    proof: ItemProof;
  }[];
  shipments: { carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; shippedAt: string }[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** What the customer should do about payment, when the order is unpaid. */
  paymentInstructions: string | null;
}

/** OrderView plus the internal id, for emails and other server-side uses. */
export interface OrderDetails extends OrderView {
  id: string;
}

/** Proof state of the whole order: the step that holds it up first. */
export function proofProgress(statuses: string[]): ProofProgress {
  if (statuses.length > 0 && statuses.every((s) => s === 'approved')) return 'approved';
  if (statuses.includes('needs_new_file')) return 'needs_new_file';
  if (statuses.includes('awaiting_customer')) return 'awaiting_customer';
  return 'pending';
}

export interface ItemProof {
  status: ProofProgress;
  /** Warnings must be acknowledged to approve; errors require a new file. */
  issues: ProofIssue[];
  /** Proof images (one per printed side), links valid for an hour. */
  images: { page: number; url: string }[];
  approvedAt: string | null;
  /** The automatic check could not run; staff look at it. */
  checkFailed: boolean;
}

const PROOF_LINK_SECONDS = 3600;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
    private readonly storage: StorageService,
  ) {}

  private async proofOf(item: typeof orderItems.$inferSelect, orderNumber: number): Promise<ItemProof> {
    const preflight = item.preflight as unknown as PreflightRecord | null;
    const images = await Promise.all(
      (preflight?.proofs ?? []).map(async (p) => ({
        page: p.page,
        url: await this.storage.presignGet(p.key, `order-${orderNumber}-proof-${p.page}.png`, PROOF_LINK_SECONDS, 'inline'),
      })),
    );
    return {
      status: item.proofStatus as ProofProgress,
      issues: preflight?.issues ?? [],
      images,
      approvedAt: iso(item.proofApprovedAt),
      checkFailed: Boolean(preflight?.error),
    };
  }

  /** Order for its customer-facing link: the number plus the secret token from that link. */
  async viewWithToken(number: number, token: string | undefined): Promise<OrderView> {
    if (!token) throw new NotFoundException('Order not found');
    const order = await this.details(and(eq(orders.number, number), eq(orders.accessTokenHash, hashOrderToken(token)))!);
    if (!order) throw new NotFoundException('Order not found');
    const { id: _id, ...view } = order;
    return view;
  }

  async byId(orderId: string): Promise<OrderDetails | null> {
    return this.details(eq(orders.id, orderId));
  }

  async byNumber(number: number): Promise<OrderDetails | null> {
    return this.details(eq(orders.number, number));
  }

  /** Order id when the number and email belong together (case-insensitive email). */
  async findIdByNumberAndEmail(number: number, email: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.number, number), eq(sql`lower(${orders.email})`, email.trim().toLowerCase())))
      .limit(1);
    return row?.id ?? null;
  }

  private async details(where: SQL): Promise<OrderDetails | null> {
    const [order] = await this.db.select().from(orders).where(where).limit(1);
    if (!order) return null;

    const [items, shipped, [lastPayment]] = await Promise.all([
      this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt)),
      this.db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(asc(shipments.shippedAt)),
      this.db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)).limit(1),
    ]);

    const unpaidWithThisProvider =
      order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && lastPayment?.provider === this.payment.code;
    const method = order.shippingMethod as OrderView['shippingMethod'];
    const tax = order.tax as OrderView['tax'];
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      paymentStatus: order.paymentStatus,
      proofStatus: proofProgress(items.map((i) => i.proofStatus)),
      email: order.email,
      placedAt: order.placedAt.toISOString(),
      paidAt: iso(order.paidAt),
      shippedAt: iso(order.shippedAt),
      cancelledAt: iso(order.cancelledAt),
      shipBy: order.shipBy,
      deliverFrom: order.deliverFrom,
      deliverTo: order.deliverTo,
      shippingAddress: order.shippingAddress as unknown as ShippingAddress,
      shippingMethod: {
        label: method.label,
        priceCents: method.priceCents,
        transitDaysMin: method.transitDaysMin,
        transitDaysMax: method.transitDaysMax,
      },
      tax: { label: tax.label, rateBps: tax.rateBps },
      items: await Promise.all(
        items.map(async (item, index) => ({
          number: index + 1,
          productName: item.productName,
          summary: (item.quote as { summary?: OrderView['items'][number]['summary'] }).summary ?? [],
          design: item.design,
          quantity: item.quantity,
          totalCents: item.totalCents,
          proof: await this.proofOf(item, order.number),
        })),
      ),
      shipments: shipped.map((s) => ({
        carrier: s.carrier,
        service: s.service,
        trackingNumber: s.trackingNumber,
        trackingUrl: trackingUrl(s.carrier, s.trackingNumber),
        shippedAt: s.shippedAt.toISOString(),
      })),
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      paymentInstructions: unpaidWithThisProvider
        ? this.payment.instructions({ orderId: order.id, orderNumber: order.number, amountCents: order.totalCents, email: order.email })
        : null,
    };
  }
}
