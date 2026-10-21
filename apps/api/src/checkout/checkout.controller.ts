import { Body, Controller, HttpCode, Ip, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerSessions, customerToken } from '../accounts/customer-session.js';
import { cartToken } from '../cart/cart-cookie.js';
import { CartService } from '../cart/cart.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { checkoutQuoteSchema, placeOrderSchema, type CheckoutQuoteInput, type PlaceOrderInput } from './checkout.schemas.js';
import { CheckoutService } from './checkout.service.js';

/** Guest checkout of the cart in the `cart` cookie. */
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly carts: CartService,
    private readonly customers: CustomerSessions,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('quote')
  @HttpCode(200)
  async quote(@Body(new ZodValidationPipe(checkoutQuoteSchema)) body: CheckoutQuoteInput, @Req() request: Request) {
    return this.checkout.quote(await this.carts.findCart(cartToken(request)), body);
  }

  /**
   * Spam guard (open issue X5): at most 20 attempts per IP and 10 per email an hour, failed ones
   * included (bots probe with bad requests). A print shop customer rarely places more than a few.
   */
  @Post('orders')
  async place(@Body(new ZodValidationPipe(placeOrderSchema)) body: PlaceOrderInput, @Req() request: Request, @Ip() ip: string) {
    await this.limiter.consume(`checkout:ip:${ip}`, 20, 3600);
    await this.limiter.consume(`checkout:email:${body.email}`, 10, 3600);
    // Signed-in customers get the order in their account; guests can claim it later by email.
    const customer = await this.customers.resolve(customerToken(request));
    return this.checkout.placeOrder(await this.carts.findCart(cartToken(request)), body, customer?.id ?? null);
  }
}
