import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderEvents, orderItems, orders, type Database } from '@printing/db';
import { asc, eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';
import type { PrintSpec } from '../print/print-spec.js';
import { StorageService } from '../storage/storage.service.js';
import { isUploadKey } from '../uploads/upload-kinds.js';
import { hashOrderToken } from './order-link.js';
import { OrderScheduleService } from './order-schedule.service.js';
import { PrepressService, type PreflightRecord } from './prepress.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type OrderRow = typeof orders.$inferSelect;
type ItemRow = typeof orderItems.$inferSelect;

export interface FileRef {
  key: string;
  fileName: string;
  pageCount: number;
}

/** Who acts on a proof: the customer (from the order link) or a staff user. */
export type ProofActor = { kind: 'customer'; orderToken: string | undefined } | { kind: 'staff'; staffId: string };

/** Orders whose proofs can still change. */
const OPEN_STATUSES = new Set(['placed']);

/**
 * Proof approval and file replacement (Phase 2 step 8, spec §6.4): warnings must be acknowledged one
 * by one, errors need a new file, and approval of the last proof of a paid order restarts the
 * ship-date estimate (production can start now).
 */
@Injectable()
export class ProofsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly prepress: PrepressService,
    private readonly storage: StorageService,
    private readonly schedule: OrderScheduleService,
  ) {}

  async approve(orderNumber: number, itemNumber: number, actor: ProofActor, acknowledged: string[] = []): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { order, item, items } = await this.lock(tx, orderNumber, itemNumber, actor);
      if (!OPEN_STATUSES.has(order.status)) throw new ConflictException('This order can no longer change.');
      if (item.proofStatus !== 'awaiting_customer') throw new ConflictException('This proof is not waiting for approval.');

      const issues = (item.preflight as unknown as PreflightRecord | null)?.issues ?? [];
      if (actor.kind === 'customer') {
        const missing = issues.filter((i) => i.level === 'warning' && !acknowledged.includes(i.id));
        if (missing.length) {
          throw new BadRequestException({ message: 'Please confirm each note about your file before approving.', issues: missing.map((i) => i.message) });
        }
      }

      const now = new Date();
      await tx
        .update(orderItems)
        .set({ proofStatus: 'approved', proofApprovedAt: now, proofApprovedBy: actor.kind === 'customer' ? 'customer' : actor.staffId })
        .where(eq(orderItems.id, item.id));

      const allApproved = items.every((i) => i.id === item.id || i.proofStatus === 'approved');
      const dates = allApproved && order.paymentStatus === 'paid' ? await this.schedule.datesFrom(tx, order, now) : null;
      if (dates) await tx.update(orders).set(dates).where(eq(orders.id, order.id));

      const by = actor.kind === 'customer' ? 'by the customer' : 'for the customer (staff)';
      const acknowledgedCount = issues.filter((i) => i.level === 'warning').length;
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'proof_approved',
        message: `Proof approved ${by} for item ${itemNumber}${acknowledgedCount ? ` (${acknowledgedCount} note(s) accepted)` : ''}${dates ? ` · ships by ${dates.shipBy}` : ''}`,
        createdBy: actor.kind === 'customer' ? 'customer' : actor.staffId,
      });
    });
  }

  /** The customer uploads a corrected PDF for an uploaded design; it is checked again. */
  async replaceFile(orderNumber: number, itemNumber: number, actor: ProofActor, files: { front: FileRef; back?: FileRef }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { order, item } = await this.lock(tx, orderNumber, itemNumber, actor);
      if (!OPEN_STATUSES.has(order.status)) throw new ConflictException('This order can no longer change.');
      if ((item.design as { mode: string }).mode !== 'upload') {
        throw new ConflictException('This item uses a template; reply to your order email to change it.');
      }
      if (item.proofStatus === 'pending') throw new ConflictException('We are still checking the current file. Try again in a minute.');

      for (const [label, file] of [['front', files.front], ['back', files.back]] as const) {
        if (file && (!isUploadKey('artwork', file.key) || !(await this.storage.describe(file.key)))) {
          throw new BadRequestException(`The ${label} PDF was not found. Please upload it again.`);
        }
      }
      const backMode = ((item.printSpec as unknown as PrintSpec | null)?.backMode ?? 'separate');
      if (backMode === 'separate' && !files.back && files.front.pageCount < 2) {
        throw new BadRequestException('Add your back design: upload a back file or a 2-page PDF.');
      }
      const design = { mode: 'upload', front: files.front, ...(backMode === 'separate' && files.back ? { back: files.back } : {}) };
      await tx.update(orderItems).set({ design }).where(eq(orderItems.id, item.id));
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'file_replaced',
        message: `New file for item ${itemNumber}: ${files.front.fileName}${files.back ? ` + ${files.back.fileName}` : ''}`,
        createdBy: actor.kind === 'customer' ? 'customer' : actor.staffId,
      });
    });
    await this.prepress.queueItem(orderNumber, itemNumber);
  }

  /** Staff: build the print file and check it again (after a failed check, or a template change). */
  async recheck(orderNumber: number, itemNumber: number, staffId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { order } = await this.lock(tx, orderNumber, itemNumber, { kind: 'staff', staffId });
      if (!OPEN_STATUSES.has(order.status)) throw new ConflictException('This order can no longer change.');
      await tx.insert(orderEvents).values({ orderId: order.id, type: 'preflight_requested', message: `File check started again for item ${itemNumber}`, createdBy: staffId });
    });
    await this.prepress.queueItem(orderNumber, itemNumber);
  }

  /** Locks the order (and checks the customer's link token) and returns the item. */
  private async lock(tx: Tx, orderNumber: number, itemNumber: number, actor: ProofActor): Promise<{ order: OrderRow; item: ItemRow; items: ItemRow[] }> {
    const [order] = await tx.select().from(orders).where(eq(orders.number, orderNumber)).for('update');
    const tokenOk = actor.kind === 'staff' || (actor.orderToken && order?.accessTokenHash === hashOrderToken(actor.orderToken));
    if (!order || !tokenOk) throw new NotFoundException('Order not found');
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt));
    const item = items[itemNumber - 1];
    if (!item) throw new NotFoundException(`Order #${orderNumber} has no item ${itemNumber}`);
    return { order, item, items };
  }
}
