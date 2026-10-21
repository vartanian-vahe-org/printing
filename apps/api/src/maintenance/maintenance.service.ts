import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { cartItems, carts, customerSessions, customerTokens, orderItems, staffPasswordResets, staffSessions, type Database } from '@printing/db';
import { Queue, Worker } from 'bullmq';
import { lt, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';
import { StorageService } from '../storage/storage.service.js';
import { UPLOAD_KINDS } from '../uploads/upload-kinds.js';

export interface CleanupOptions {
  /** Carts untouched this long are deleted (default: the cart cookie lifetime). */
  cartsOlderThanDays?: number;
  /** Uploads this old that no cart or order uses are deleted. */
  uploadsOlderThanDays?: number;
}

export interface CleanupResult {
  carts: number;
  uploads: number;
  expiredSessionsAndLinks: number;
}

const DAY_MS = 24 * 3600 * 1000;
const QUEUE = 'maintenance';

/**
 * Housekeeping (open issues S11, X2), daily at 10:00 UTC (about 3 AM Pacific): abandoned carts,
 * uploads nobody uses (a customer tried a file and left), expired sessions and one-time links.
 * Files on orders are never touched: print files, proofs and the customer's own uploads stay.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit() {
    this.queue = new Queue(QUEUE, { connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }) });
    // One schedule for every API instance (BullMQ dedupes the repeatable job by its key).
    await this.queue.upsertJobScheduler('daily-cleanup', { pattern: '0 10 * * *', tz: 'UTC' }, { name: 'cleanup' });
    this.worker = new Worker(QUEUE, async () => this.logger.log(`Cleanup: ${JSON.stringify(await this.cleanup())}`), {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async cleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
    const now = Date.now();
    const cartCutoff = new Date(now - (options.cartsOlderThanDays ?? config.cart.cookieDays) * DAY_MS);
    const uploadCutoff = new Date(now - (options.uploadsOlderThanDays ?? 30) * DAY_MS);

    const deletedCarts = await this.db.delete(carts).where(lt(carts.updatedAt, cartCutoff)).returning({ id: carts.id });
    const uploads = await this.cleanupUploads(uploadCutoff);

    const nowDate = new Date(now);
    const expired = await Promise.all([
      this.db.delete(staffSessions).where(lt(staffSessions.expiresAt, nowDate)).returning({ id: staffSessions.id }),
      this.db.delete(customerSessions).where(lt(customerSessions.expiresAt, nowDate)).returning({ id: customerSessions.id }),
      this.db.delete(customerTokens).where(lt(customerTokens.expiresAt, nowDate)).returning({ id: customerTokens.id }),
      this.db.delete(staffPasswordResets).where(lt(staffPasswordResets.expiresAt, nowDate)).returning({ id: staffPasswordResets.id }),
    ]);
    return { carts: deletedCarts.length, uploads, expiredSessionsAndLinks: expired.reduce((n, rows) => n + rows.length, 0) };
  }

  /** Customer uploads older than the cutoff that no cart item or order item references. */
  private async cleanupUploads(cutoff: Date): Promise<number> {
    const used = new Set<string>();
    for (const table of [cartItems, orderItems]) {
      const rows = await this.db
        .select({ keys: sql<(string | null)[]>`array[${table.design}->'front'->>'key', ${table.design}->'back'->>'key', ${table.design}->>'logoKey']` })
        .from(table);
      for (const row of rows) for (const key of row.keys) if (key) used.add(key);
    }

    const unused: string[] = [];
    for (const kind of Object.values(UPLOAD_KINDS)) {
      for await (const object of this.storage.list(kind.prefix)) {
        if (object.lastModified < cutoff && !used.has(object.key)) unused.push(object.key);
      }
    }
    if (unused.length) await this.storage.deleteMany(unused);
    return unused.length;
  }
}
