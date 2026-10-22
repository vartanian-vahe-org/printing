import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { orderEvents, orderItems, orders, type Database } from '@printing/db';
import { Queue, Worker, type Job } from 'bullmq';
import { asc, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';
import { PrintFilesService } from '../print/print-files.service.js';
import type { PrintSpec } from '../print/print-spec.js';
import { StorageService } from '../storage/storage.service.js';
import { OrderEmailQueue } from './order-email.queue.js';

export interface ProofIssue {
  /** Unique within the item; what the customer acknowledges. */
  id: string;
  code: string;
  level: 'error' | 'warning';
  message: string;
  page?: number;
}

/** order_items.preflight */
export interface PreflightRecord {
  run: string;
  queuedAt: string;
  checkedAt?: string;
  issues?: ProofIssue[];
  proofs?: { page: number; key: string }[];
  /** Layout warnings from drawing a template (text shrunk to the minimum). */
  layoutIssues: ProofIssue[];
  /** The worker could not check the file (staff re-run it). */
  error?: string;
}

interface PrepressJob {
  orderItemId: string;
  printKey: string;
  run: string;
  mode: 'template' | 'upload';
  geometry: PrintSpec['geometry'];
  expectedPages: number;
}

interface PrepressResult {
  orderItemId: string;
  printKey: string;
  run: string;
  ok: boolean;
  issues?: { code: string; level: 'error' | 'warning'; message: string; page?: number }[];
  proofs?: { page: number; key: string }[];
  error?: string;
}

const JOBS_QUEUE = 'prepress';
const RESULTS_QUEUE = 'prepress-results';

const issueId = (code: string, page?: number) => (page ? `${code}@${page}` : code);

/**
 * File check and proof (Phase 2 step 8). For each order item: build the print file, store it, and
 * queue it for the Python prepress worker; the worker's results come back on another queue and
 * set the item's proof status. Customers are emailed once every item of the order is checked.
 */
@Injectable()
export class PrepressService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrepressService.name);
  private jobs!: Queue<PrepressJob>;
  private results!: Worker<PrepressResult>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly printFiles: PrintFilesService,
    private readonly storage: StorageService,
    private readonly emails: OrderEmailQueue,
  ) {}

  onModuleInit() {
    this.jobs = new Queue(JOBS_QUEUE, {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } },
    });
    this.results = new Worker(RESULTS_QUEUE, (job) => this.record(job), {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
      concurrency: 4,
    });
    this.results.on('failed', (job, err) => this.logger.error(`prepress result for ${job?.data.orderItemId} failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.results?.close();
    await this.jobs?.close();
  }

  /** Checks every item of a new order (designed-for-you items wait for the designer's file). */
  async queueOrder(orderId: string): Promise<void> {
    const [order] = await this.db.select({ number: orders.number }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return;
    const items = await this.db
      .select({ id: orderItems.id, proofStatus: orderItems.proofStatus })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt));
    for (const [index, item] of items.entries()) {
      if (item.proofStatus !== 'awaiting_design') await this.queueItem(order.number, index + 1);
    }
  }

  /** (Re)checks one item: new print file, proof back to "pending". `itemNumber` is 1-based. */
  async queueItem(orderNumber: number, itemNumber: number): Promise<void> {
    const file = await this.printFiles.forOrderItem(orderNumber, itemNumber);
    const item = file.item;
    const run = Date.now().toString(36);
    const printKey = `print-files/${item.orderId}/${item.id}/${run}.pdf`;
    await this.storage.write(printKey, file.bytes, 'application/pdf');

    const spec = file.spec;
    const labels = new Map(spec.template?.layout.fields.map((f) => [f.key, f.label]) ?? []);
    const layoutIssues: ProofIssue[] = file.warnings.map((w) => ({
      id: issueId(`text-too-long-${w.field}`),
      code: 'text-too-long',
      level: 'warning',
      message: `${labels.get(w.field) ?? w.field}: the text is long, so it is printed at the smallest size and may be hard to read.`,
    }));
    const record: PreflightRecord = { run, queuedAt: new Date().toISOString(), layoutIssues };
    await this.db
      .update(orderItems)
      .set({ printKey, proofStatus: 'pending', preflight: record as unknown as Record<string, unknown>, proofApprovedAt: null, proofApprovedBy: null })
      .where(eq(orderItems.id, item.id));

    const design = item.design as { mode: 'template' | 'upload' | 'service' };
    await this.jobs.add(
      'check',
      // A designer's file is checked like a customer's upload.
      { orderItemId: item.id, printKey, run, mode: design.mode === 'template' ? 'template' : 'upload', geometry: spec.geometry, expectedPages: file.pageCount },
      { jobId: `${item.id}_${run}` },
    );
  }

  /** A worker result: store issues and proofs, set the proof status, tell the customer when the order is done. */
  private async record(job: Job<PrepressResult>): Promise<void> {
    const result = job.data;
    const outcome = await this.db.transaction(async (tx) => {
      const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, result.orderItemId)).for('update');
      // A newer file was queued since (customer re-upload, staff re-run): this result is stale.
      if (!item || item.printKey !== result.printKey) return null;
      const previous = (item.preflight ?? { layoutIssues: [] }) as unknown as PreflightRecord;

      if (!result.ok) {
        await tx
          .update(orderItems)
          .set({ preflight: { ...previous, checkedAt: new Date().toISOString(), error: result.error } as unknown as Record<string, unknown> })
          .where(eq(orderItems.id, item.id));
        await tx.insert(orderEvents).values({ orderId: item.orderId, type: 'preflight_failed', message: `File check could not run: ${result.error}`, createdBy: 'system' });
        return { orderId: item.orderId, settled: false };
      }

      const issues: ProofIssue[] = [
        ...previous.layoutIssues,
        ...(result.issues ?? []).map((i) => ({ ...i, id: issueId(i.code, i.page) })),
      ];
      const status = issues.some((i) => i.level === 'error') ? 'needs_new_file' : 'awaiting_customer';
      const record: PreflightRecord = { ...previous, checkedAt: new Date().toISOString(), issues, proofs: result.proofs ?? [], error: undefined };
      await tx.update(orderItems).set({ proofStatus: status, preflight: record as unknown as Record<string, unknown> }).where(eq(orderItems.id, item.id));

      const errors = issues.filter((i) => i.level === 'error').length;
      const warnings = issues.length - errors;
      await tx.insert(orderEvents).values({
        orderId: item.orderId,
        type: 'preflight',
        message: `File check for ${item.productName}: ${errors ? `${errors} error(s), ` : ''}${warnings} warning(s) · proof ${status === 'needs_new_file' ? 'blocked, new file needed' : 'ready for the customer'}`,
        data: { orderItemId: item.id, status },
        createdBy: 'system',
      });
      return { orderId: item.orderId, settled: true };
    });
    if (outcome?.settled) await this.notifyWhenOrderChecked(outcome.orderId);
  }

  /** One email per check round: when no item of the order is still waiting for its check. */
  private async notifyWhenOrderChecked(orderId: string) {
    const [order] = await this.db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || order.status === 'cancelled') return;
    const items = await this.db.select({ status: orderItems.proofStatus, design: orderItems.design }).from(orderItems).where(eq(orderItems.orderId, orderId));
    if (items.some((i) => i.status === 'pending')) return;
    // A designer's file with errors is ours to fix, not the customer's.
    const customerFileNeeded = items.some((i) => i.status === 'needs_new_file' && (i.design as { mode?: string }).mode !== 'service');
    if (customerFileNeeded) await this.emails.send('files-needed', orderId);
    else if (items.some((i) => i.status === 'awaiting_customer')) await this.emails.send('proof-ready', orderId);
  }
}
