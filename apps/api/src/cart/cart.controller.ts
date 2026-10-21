import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomerSessions, customerToken } from '../accounts/customer-session.js';
import { cartCookie, cartToken } from './cart-cookie.js';
import { addItemSchema, updateItemSchema, type AddItemInput } from './cart.schemas.js';
import { CartService } from './cart.service.js';

/**
 * Guest cart identified by an httpOnly cookie. The cart is created on the first "add to cart".
 * Prices are always recalculated from the current catalog.
 */
@Controller('cart')
export class CartController {
  constructor(
    private readonly carts: CartService,
    private readonly customers: CustomerSessions,
  ) {}

  private token(request: Request) {
    return cartToken(request);
  }

  @Get()
  async get(@Req() request: Request) {
    return this.carts.view(await this.carts.findCart(this.token(request)));
  }

  @Post('items')
  async add(
    @Body(new ZodValidationPipe(addItemSchema)) body: AddItemInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const item = await this.carts.prepareItem(body);
    let cartId = await this.carts.findCart(this.token(request));
    if (!cartId) {
      // A signed-in customer's new cart is saved to the account (it follows them to other devices).
      const customer = await this.customers.resolve(customerToken(request));
      const created = await this.carts.createCart(customer?.id);
      cartId = created.cartId;
      response.setHeader('Set-Cookie', cartCookie(created.token));
    }
    await this.carts.addItem(cartId, item);
    return this.carts.view(cartId);
  }

  @Patch('items/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: { quantity: number },
    @Req() request: Request,
  ) {
    const cartId = await this.requireCart(request);
    await this.carts.updateQuantity(cartId, id, body.quantity);
    return this.carts.view(cartId);
  }

  /** Edit an item: new options and design, priced and checked again. */
  @Put('items/:id')
  async replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(addItemSchema)) body: AddItemInput,
    @Req() request: Request,
  ) {
    const cartId = await this.requireCart(request);
    await this.carts.replaceItem(cartId, id, await this.carts.prepareItem(body));
    return this.carts.view(cartId);
  }

  @Delete('items/:id')
  @HttpCode(200)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: Request) {
    const cartId = await this.requireCart(request);
    await this.carts.removeItem(cartId, id);
    return this.carts.view(cartId);
  }

  private async requireCart(request: Request): Promise<string> {
    const cartId = await this.carts.findCart(this.token(request));
    if (!cartId) throw new NotFoundException('Cart not found');
    return cartId;
  }
}
