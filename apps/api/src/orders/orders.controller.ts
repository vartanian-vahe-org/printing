import { Body, Controller, Get, Headers, HttpCode, Ip, Param, ParseIntPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { OrderEmailQueue } from './order-email.queue.js';
import { OrdersService } from './orders.service.js';
import { ProofsService } from './proofs.service.js';

const approveSchema = z.object({ acknowledged: z.array(z.string().max(100)).max(50).default([]) }).strict();

const fileRef = z
  .object({ key: z.string().min(1).max(200), fileName: z.string().trim().min(1).max(255), pageCount: z.number().int().min(1).max(10_000) })
  .strict();
const replaceFileSchema = z.object({ front: fileRef, back: fileRef.optional() }).strict();
const changesSchema = z.object({ message: z.string().trim().min(5, 'Tell our designer what to change').max(3000) }).strict();

const lookupSchema = z
  .object({
    number: z.number().int().positive(),
    email: z.string().trim().max(254),
  })
  .strict();

/** Same answer whether or not the order exists, so the form cannot be used to probe orders. */
const LOOKUP_REPLY = { message: 'If that order number matches the email, we sent a link to the order to that address.' };

/**
 * Customer view of one order. The secret from the order link (kept in the URL fragment by the
 * storefront, so it never reaches server logs) is sent in the `X-Order-Token` header.
 */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly emails: OrderEmailQueue,
    private readonly limiter: RateLimiter,
    private readonly proofs: ProofsService,
  ) {}

  @Get(':number')
  view(@Param('number', ParseIntPipe) number: number, @Headers('x-order-token') token: string | undefined) {
    return this.orders.viewWithToken(number, token);
  }

  /** The customer approves an item's proof, confirming each warning by its id. */
  @Post(':number/items/:item/proof/approve')
  @HttpCode(204)
  async approveProof(
    @Param('number', ParseIntPipe) number: number,
    @Param('item', ParseIntPipe) item: number,
    @Headers('x-order-token') token: string | undefined,
    @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>,
  ) {
    await this.proofs.approve(number, item, { kind: 'customer', orderToken: token }, body.acknowledged);
  }

  /** The customer replaces an uploaded PDF (uploaded first with POST /uploads/presign); it is checked again. */
  @Post(':number/items/:item/file')
  @HttpCode(202)
  async replaceFile(
    @Param('number', ParseIntPipe) number: number,
    @Param('item', ParseIntPipe) item: number,
    @Headers('x-order-token') token: string | undefined,
    @Body(new ZodValidationPipe(replaceFileSchema)) body: z.infer<typeof replaceFileSchema>,
  ) {
    await this.proofs.replaceFile(number, item, { kind: 'customer', orderToken: token }, body);
    return { message: 'Thanks! We are checking your new file.' };
  }

  /** The customer asks our designer for changes ("let us design it" items); staff are emailed. */
  @Post(':number/items/:item/proof/changes')
  @HttpCode(202)
  async requestChanges(
    @Param('number', ParseIntPipe) number: number,
    @Param('item', ParseIntPipe) item: number,
    @Headers('x-order-token') token: string | undefined,
    @Body(new ZodValidationPipe(changesSchema)) body: z.infer<typeof changesSchema>,
  ) {
    await this.proofs.requestChanges(number, item, { kind: 'customer', orderToken: token }, body.message);
    return { message: 'Thanks! Our designer will send you a new proof.' };
  }

  /** "Find my order": emails the order link when the number and email match. */
  @Post('lookup')
  @HttpCode(202)
  async lookup(@Body(new ZodValidationPipe(lookupSchema)) body: z.infer<typeof lookupSchema>, @Ip() ip: string) {
    await this.limiter.consume(`order-lookup:ip:${ip}`, 10, 3600);
    await this.limiter.consume(`order-lookup:order:${body.number}`, 5, 3600);
    const orderId = await this.orders.findIdByNumberAndEmail(body.number, body.email);
    if (orderId) await this.emails.orderLink(orderId);
    return LOOKUP_REPLY;
  }
}
