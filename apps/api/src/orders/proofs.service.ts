import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderEvents, orderItems, orders, type Database } from '@printing/db';
import { asc, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { DATABASE } from '../database/database.tokens.js';
import type { PrintSpec } from '../print/print-spec.js';
import { StorageService } from '../storage/storage.service.js';
import { isUploadKey } from '../uploads/upload-kinds.js';
import { OrderEmailQueue } from './order-email.queue.js';
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

/** A designed-for-you item's design (cart `service` mode plus what the designer and customer add later). */
export interface ServiceDesign {
  mode: 'service';
  tierCode: string;
  brief: { content: string; notes: string; files: { key: string; fileName: string }[] };
  /** The designer's latest file; `round` counts deliveries (1 = first draft). */
  artwork?: { front: FileRef; back?: FileRef; round: number; deliveredAt: string };
  /** The customer's change requests, oldest first. */
  changeRequests?: { message: string; at: string; round: number }[];
}

/** Design package bought with the item (order_items.quote.designService). */
interface PurchasedTier {
  name: string;
  revisions: number | null;
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
    private readonly emails: OrderEmailQueue,
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
      const mode = (item.design as { mode: string }).mode;
      if (mode === 'service') throw new ConflictException('Our designer makes this file. Ask for changes on the proof instead.');
      if (mode !== 'upload') throw new ConflictException('This item uses a template; reply to your order email to change it.');
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

  /**
   * Staff (the designer) delivers the design of a "let us design it" item: it becomes the print file
   * and is checked, then the customer gets the proof to approve or ask for changes.
   */
  async deliverDesign(
    orderNumber: number,
    itemNumber: number,
    staffId: string,
    uploaded: { front: Omit<FileRef, 'pageCount'>; back?: Omit<FileRef, 'pageCount'> },
  ): Promise<void> {
    const files = {
      front: await this.withPageCount(uploaded.front, 'front'),
      ...(uploaded.back ? { back: await this.withPageCount(uploaded.back, 'back') } : {}),
    };
    await this.db.transaction(async (tx) => {
      const { order, item } = await this.lock(tx, orderNumber, itemNumber, { kind: 'staff', staffId });
      if (!OPEN_STATUSES.has(order.status)) throw new ConflictException('This order can no longer change.');
      const design = item.design as unknown as ServiceDesign;
      if (design.mode !== 'service') throw new ConflictException('This item was not ordered with the design service.');
      if (item.proofStatus === 'approved') throw new ConflictException('The customer already approved this design.');
      if (item.proofStatus === 'pending') throw new ConflictException('The last file is still being checked. Try again in a minute.');

      const backMode = (item.printSpec as unknown as PrintSpec | null)?.backMode ?? 'separate';
      if (backMode === 'separate' && !files.back && files.front.pageCount < 2) {
        throw new BadRequestException('This card has a back: upload a back file or a 2-page PDF.');
      }
      const round = (design.artwork?.round ?? 0) + 1;
      const artwork = { front: files.front, ...(backMode === 'separate' && files.back ? { back: files.back } : {}), round, deliveredAt: new Date().toISOString() };
      await tx.update(orderItems).set({ design: { ...design, artwork } }).where(eq(orderItems.id, item.id));
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'design_delivered',
        message: `Design ${round === 1 ? 'first draft' : `revision ${round - 1}`} delivered for item ${itemNumber}: ${files.front.fileName}${files.back ? ` + ${files.back.fileName}` : ''}`,
        createdBy: staffId,
      });
    });
    await this.prepress.queueItem(orderNumber, itemNumber);
  }

  /**
   * The customer asks the designer for changes to a "let us design it" proof. Limited to the rounds
   * included in the package bought; staff are told by email.
   */
  async requestChanges(orderNumber: number, itemNumber: number, actor: ProofActor, message: string): Promise<void> {
    const orderId = await this.db.transaction(async (tx) => {
      const { order, item } = await this.lock(tx, orderNumber, itemNumber, actor);
      if (!OPEN_STATUSES.has(order.status)) throw new ConflictException('This order can no longer change.');
      const design = item.design as unknown as ServiceDesign;
      if (design.mode !== 'service') throw new ConflictException('Changes can only be requested on designs we make for you.');
      if (item.proofStatus !== 'awaiting_customer') throw new ConflictException('This proof is not waiting for your review.');

      const tier = (item.quote as { designService?: PurchasedTier | null }).designService ?? null;
      const requests = design.changeRequests ?? [];
      if (tier?.revisions != null && requests.length >= tier.revisions) {
        throw new ConflictException(
          `Your ${tier.name} package includes ${tier.revisions} round${tier.revisions === 1 ? '' : 's'} of changes and they have been used. Reply to your order email and we will help.`,
        );
      }
      const round = design.artwork?.round ?? 0;
      const changeRequests = [...requests, { message, at: new Date().toISOString(), round }];
      await tx.update(orderItems).set({ design: { ...design, changeRequests }, proofStatus: 'awaiting_design' }).where(eq(orderItems.id, item.id));
      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'changes_requested',
        message: `Changes requested for item ${itemNumber} (${changeRequests.length}${tier?.revisions != null ? ` of ${tier.revisions}` : ''}): ${message.length > 300 ? `${message.slice(0, 300)}…` : message}`,
        createdBy: actor.kind === 'customer' ? 'customer' : actor.staffId,
      });
      return order.id;
    });
    await this.emails.send('changes-requested', orderId, `Item ${itemNumber}: ${message}`);
  }

  /** An uploaded artwork PDF with its page count, read from the file itself. */
  private async withPageCount(file: Omit<FileRef, 'pageCount'>, label: string): Promise<FileRef> {
    if (!isUploadKey('artwork', file.key) || !(await this.storage.describe(file.key))) {
      throw new BadRequestException(`The ${label} PDF was not found. Please upload it again.`);
    }
    try {
      const pdf = await PDFDocument.load(await this.storage.read(file.key), { ignoreEncryption: true, updateMetadata: false });
      return { ...file, pageCount: pdf.getPageCount() };
    } catch {
      throw new BadRequestException(`The ${label} file is not a readable PDF.`);
    }
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
