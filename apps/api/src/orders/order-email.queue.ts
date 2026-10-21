import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { orderEvents, storeSettings, type Database } from '@printing/db';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';
import { MailService, type MailMessage } from '../mail/mail.service.js';
import type { RenderedEmail, StoreIdentity } from './emails/layout.js';
import {
  filesNeededEmail,
  newOrderNotificationEmail,
  orderCancelledEmail,
  orderConfirmationEmail,
  orderLinkEmail,
  orderShippedEmail,
  paymentReceivedEmail,
  proofReadyEmail,
} from './emails/order-emails.js';
import { orderUrl } from './order-link.js';
import { OrdersService, type OrderDetails } from './orders.service.js';

export const ORDER_EMAIL_KINDS = [
  'order-confirmation',
  'new-order-notification',
  'order-link',
  'payment-received',
  'order-shipped',
  'order-cancelled',
  'proof-ready',
  'files-needed',
] as const;

export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

/** Emails staff can send again from the admin. */
export const RESENDABLE_EMAILS = ['order-confirmation', 'proof-ready', 'payment-received', 'order-shipped', 'order-cancelled'] as const;

interface OrderEmailJob {
  orderId: string;
  /** Optional text for the customer (cancellation reason). */
  note?: string;
}

const QUEUE_NAME = 'order-emails';

const LABELS: Record<OrderEmailKind, string> = {
  'order-confirmation': 'Order confirmation',
  'new-order-notification': 'New order notification',
  'order-link': 'Order link',
  'payment-received': 'Payment received',
  'order-shipped': 'Shipped',
  'order-cancelled': 'Cancellation',
  'proof-ready': 'Proof ready',
  'files-needed': 'New file needed',
};

/**
 * Order emails go through a Redis queue (decision T15) so a slow or failing SMTP server never
 * blocks or fails checkout or admin actions; failed sends are retried with backoff.
 * The worker runs inside the API process for now. Every sent email is written to the order history.
 */
@Injectable()
export class OrderEmailQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderEmailQueue.name);
  private queue!: Queue<OrderEmailJob, void, OrderEmailKind>;
  private worker!: Worker<OrderEmailJob, void, OrderEmailKind>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    // BullMQ needs its own connections; workers require maxRetriesPerRequest: null.
    this.queue = new Queue(QUEUE_NAME, {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
    this.worker = new Worker(QUEUE_NAME, (job) => this.process(job), {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`${job?.name} for order ${job?.data.orderId} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Customer confirmation + staff notification. Safe to call twice: job ids dedupe per order. */
  async orderPlaced(orderId: string): Promise<void> {
    await this.queue.addBulk([
      { name: 'order-confirmation', data: { orderId }, opts: { jobId: `order-confirmation_${orderId}` } },
      { name: 'new-order-notification', data: { orderId }, opts: { jobId: `new-order-notification_${orderId}` } },
    ]);
  }

  /** The order link again ("find my order"); at most one email per order every 10 minutes. */
  async orderLink(orderId: string): Promise<void> {
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    await this.queue.add('order-link', { orderId }, { jobId: `order-link_${orderId}_${bucket}` });
  }

  /** A status email after a staff action, or a resend. Not deduped: each call sends once. */
  async send(kind: OrderEmailKind, orderId: string, note?: string): Promise<void> {
    await this.queue.add(kind, { orderId, ...(note ? { note } : {}) });
  }

  private async process(job: Job<OrderEmailJob, void, OrderEmailKind>): Promise<void> {
    const order = await this.orders.byId(job.data.orderId);
    if (!order) {
      this.logger.warn(`${job.name}: order ${job.data.orderId} not found, skipping`);
      return;
    }
    const [store] = await this.db.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
    if (!store) throw new Error('store_settings row is missing (migration 0011)');
    const identity: StoreIdentity = { storeName: store.storeName, supportEmail: store.supportEmail };

    const message = this.compose(job.name, order, identity, store.orderNotificationEmails, job.data.note);
    if (!message) return;
    await this.mail.send({ ...message, fromName: store.storeName });
    await this.db.insert(orderEvents).values({
      orderId: order.id,
      type: 'email_sent',
      message: `${LABELS[job.name]} email sent to ${[message.to].flat().join(', ')}`,
      data: { kind: job.name },
      createdBy: 'system',
    });
  }

  private compose(
    kind: OrderEmailKind,
    order: OrderDetails,
    store: StoreIdentity,
    staffEmails: string[],
    note: string | undefined,
  ): Omit<MailMessage, 'fromName'> | null {
    const toCustomer = (email: RenderedEmail) => ({ to: order.email, replyTo: store.supportEmail, ...email });
    const link = orderUrl(order.number, order.id);
    switch (kind) {
      case 'order-confirmation':
        return toCustomer(orderConfirmationEmail(order, store, link));
      case 'order-link':
        return toCustomer(orderLinkEmail(order, store, link));
      case 'payment-received':
        return toCustomer(paymentReceivedEmail(order, store, link));
      case 'order-shipped':
        return toCustomer(orderShippedEmail(order, store, link));
      case 'order-cancelled':
        return toCustomer(orderCancelledEmail(order, store, link, note));
      case 'proof-ready':
        return toCustomer(proofReadyEmail(order, store, link));
      case 'files-needed':
        return toCustomer(filesNeededEmail(order, store, link));
      case 'new-order-notification':
        return staffEmails.length ? { to: staffEmails, replyTo: order.email, ...newOrderNotificationEmail(order, store) } : null;
    }
  }
}
