import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { RESENDABLE_EMAILS } from '../../orders/order-email.queue.js';
import { ORDER_VIEWS } from '../../orders/order-workflow.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { AllowStaff } from '../auth/allow-staff.decorator.js';
import { ProofsService } from '../../orders/proofs.service.js';
import { PrintFilesService } from '../../print/print-files.service.js';
import { AdminOrdersService } from './admin-orders.service.js';

const listQuerySchema = z.object({
  view: z.enum(ORDER_VIEWS).default('all'),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const paymentSchema = z.object({ reference: text(200), notify: z.boolean().default(true) }).strict();
const shipmentSchema = z
  .object({
    carrier: text(40).transform((v) => v.toLowerCase()),
    service: optionalText(60),
    trackingNumber: text(60),
    notify: z.boolean().default(true),
  })
  .strict();
const cancelSchema = z.object({ reason: optionalText(500), notify: z.boolean().default(true) }).strict();
const refundSchema = z.object({ reference: text(200) }).strict();
const noteSchema = z.object({ text: text(2000) }).strict();
const resendSchema = z.object({ kind: z.enum(RESENDABLE_EMAILS) }).strict();

/**
 * Order processing. Owners and admins can do everything; the 'staff' role (production floor) can
 * move orders into production, add tracking, mark delivered, add notes and resend emails, but not
 * record payments, cancel or refund (open issue A6).
 */
@Controller('admin/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly printFiles: PrintFilesService,
    private readonly proofs: ProofsService,
  ) {}

  /** Approve a proof for the customer (approval given by phone or email). Owners and admins only. */
  @Post(':number/items/:item/proof/approve')
  @HttpCode(204)
  async approveProof(@Param('number', ParseIntPipe) number: number, @Param('item', ParseIntPipe) item: number, @Req() request: AdminRequest) {
    await this.proofs.approve(number, item, { kind: 'staff', staffId: request.staff!.id });
  }

  /** Build the print file and run the file check again. */
  @Post(':number/items/:item/preflight')
  @AllowStaff()
  @HttpCode(202)
  async recheck(@Param('number', ParseIntPipe) number: number, @Param('item', ParseIntPipe) item: number, @Req() request: AdminRequest) {
    await this.proofs.recheck(number, item, request.staff!.id);
    return { message: 'File check queued' };
  }

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.orders.list(query.view, query.q, query.page);
  }

  @Get(':number')
  detail(@Param('number', ParseIntPipe) number: number) {
    return this.orders.detail(number);
  }

  /** Print-ready PDF of one item (1-based), downloaded as a file. */
  @Get(':number/items/:item/print-file')
  async printFile(
    @Param('number', ParseIntPipe) number: number,
    @Param('item', ParseIntPipe) item: number,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.printFiles.forOrderItem(number, item);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    response.setHeader('X-Print-Pages', String(file.pageCount));
    if (file.warnings.length) response.setHeader('X-Print-Warnings', file.warnings.map((w) => `${w.field}:${w.issue}`).join(','));
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Print-Pages, X-Print-Warnings');
    return new StreamableFile(file.bytes);
  }

  @Post(':number/payments')
  @HttpCode(204)
  async recordPayment(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(paymentSchema)) body: z.infer<typeof paymentSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.recordPayment(number, body, request.staff!.id);
  }

  @Post(':number/production')
  @AllowStaff()
  @HttpCode(204)
  async startProduction(@Param('number', ParseIntPipe) number: number, @Req() request: AdminRequest) {
    await this.orders.startProduction(number, request.staff!.id);
  }

  @Post(':number/shipments')
  @AllowStaff()
  @HttpCode(204)
  async addShipment(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(shipmentSchema)) body: z.infer<typeof shipmentSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.addShipment(number, body, request.staff!.id);
  }

  @Post(':number/delivered')
  @AllowStaff()
  @HttpCode(204)
  async markDelivered(@Param('number', ParseIntPipe) number: number, @Req() request: AdminRequest) {
    await this.orders.markDelivered(number, request.staff!.id);
  }

  @Post(':number/cancel')
  @HttpCode(204)
  async cancel(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(cancelSchema)) body: z.infer<typeof cancelSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.cancel(number, body, request.staff!.id);
  }

  @Post(':number/refunds')
  @HttpCode(204)
  async recordRefund(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(refundSchema)) body: z.infer<typeof refundSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.recordRefund(number, body, request.staff!.id);
  }

  @Post(':number/notes')
  @AllowStaff()
  @HttpCode(204)
  async addNote(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.addNote(number, body.text, request.staff!.id);
  }

  @Post(':number/emails')
  @AllowStaff()
  @HttpCode(204)
  async resendEmail(
    @Param('number', ParseIntPipe) number: number,
    @Body(new ZodValidationPipe(resendSchema)) body: z.infer<typeof resendSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.orders.resendEmail(number, body.kind, request.staff!.id);
  }
}
