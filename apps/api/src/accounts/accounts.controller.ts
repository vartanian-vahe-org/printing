import { Body, Controller, Get, HttpCode, Ip, Param, ParseIntPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { cartCookie, cartToken } from '../cart/cart-cookie.js';
import { CartService } from '../cart/cart.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { AccountsService } from './accounts.service.js';
import { clearedCustomerCookie, customerCookie, CustomerSessions, customerToken } from './customer-session.js';
import { CustomerGuard, type CustomerRequest } from './customer.guard.js';

const password = z.string().min(10, 'Use at least 10 characters').max(200);
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));
const registerSchema = z.object({ email, name: z.string().trim().min(1).max(100), password }).strict();
const signInSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();
const tokenSchema = z.object({ token: z.string().min(20).max(100) }).strict();
const forgotSchema = z.object({ email }).strict();
const profileSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).strict();
const resetSchema = z.object({ token: z.string().min(20).max(100), password }).strict();

/** Customer accounts (Phase 2 step 10). Guests can still check out without one. */
@Controller('account')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly sessions: CustomerSessions,
    private readonly carts: CartService,
    private readonly limiter: RateLimiter,
  ) {}

  /** The signed-in customer, or null (200 either way, so the storefront header can ask freely). */
  @Get('me')
  async me(@Req() request: Request) {
    const customer = await this.sessions.resolve(customerToken(request));
    return customer ? this.accounts.profile(customer) : { customer: null };
  }

  @Post('register')
  async register(@Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>, @Req() request: Request, @Res({ passthrough: true }) response: Response, @Ip() ip: string) {
    await this.limiter.consume(`account-register:ip:${ip}`, 10, 3600);
    const { customerId, sessionToken } = await this.accounts.register(body);
    await this.startSession(customerId, sessionToken, request, response);
    return this.accounts.profile((await this.sessions.resolve(sessionToken))!);
  }

  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body(new ZodValidationPipe(signInSchema)) body: z.infer<typeof signInSchema>, @Req() request: Request, @Res({ passthrough: true }) response: Response, @Ip() ip: string) {
    await this.limiter.consume(`account-sign-in:ip:${ip}`, 20, 900);
    await this.limiter.consume(`account-sign-in:email:${body.email}`, 10, 900);
    const { customerId, sessionToken } = await this.accounts.signIn(body.email, body.password);
    await this.startSession(customerId, sessionToken, request, response);
    return this.accounts.profile((await this.sessions.resolve(sessionToken))!);
  }

  @Post('sign-out')
  @HttpCode(204)
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = customerToken(request);
    if (token) await this.sessions.revoke(token);
    response.setHeader('Set-Cookie', clearedCustomerCookie());
  }

  @Post('verify')
  @HttpCode(204)
  async verify(@Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    await this.accounts.verifyEmail(body.token);
  }

  @Post('verify/resend')
  @UseGuards(CustomerGuard)
  @HttpCode(202)
  async resendVerification(@Req() request: CustomerRequest) {
    await this.accounts.sendVerification(request.customer!.id);
    return { message: 'We sent you a new link.' };
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body(new ZodValidationPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Ip() ip: string) {
    await this.limiter.consume(`account-forgot:ip:${ip}`, 10, 3600);
    await this.limiter.consume(`account-forgot:email:${body.email}`, 5, 3600);
    await this.accounts.forgotPassword(body.email);
    return { message: 'If an account uses this email, we sent a link to reset the password.' };
  }

  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodValidationPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Ip() ip: string) {
    await this.limiter.consume(`account-reset:ip:${ip}`, 20, 3600);
    await this.accounts.resetPassword(body.token, body.password);
  }

  @Patch('profile')
  @UseGuards(CustomerGuard)
  async updateProfile(@Body(new ZodValidationPipe(profileSchema)) body: z.infer<typeof profileSchema>, @Req() request: CustomerRequest) {
    await this.accounts.updateName(request.customer!.id, body.name);
    return this.accounts.profile((await this.sessions.resolve(customerToken(request)))!);
  }

  @Post('password')
  @UseGuards(CustomerGuard)
  @HttpCode(204)
  async changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @Req() request: CustomerRequest, @Ip() ip: string) {
    await this.limiter.consume(`account-password:ip:${ip}`, 10, 900);
    await this.accounts.changePassword(request.customer!.id, body.currentPassword, body.newPassword, customerToken(request));
  }

  @Get('orders')
  @UseGuards(CustomerGuard)
  orders(@Req() request: CustomerRequest) {
    return this.accounts.orders(request.customer!.id);
  }

  @Post('orders/:number/reorder')
  @UseGuards(CustomerGuard)
  async reorder(@Param('number', ParseIntPipe) number: number, @Req() request: CustomerRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.accounts.reorder(request.customer!.id, number, cartToken(request));
    if (result.newCartToken) response.setHeader('Set-Cookie', cartCookie(result.newCartToken));
    return { added: result.added, skipped: result.skipped };
  }

  /** Sign-in cookie, plus the cart: this browser's cart joins the account's saved cart. */
  private async startSession(customerId: string, sessionToken: string, request: Request, response: Response) {
    const cookies = [customerCookie(sessionToken)];
    const newCart = await this.carts.adoptOnSignIn(customerId, cartToken(request));
    if (newCart) cookies.push(cartCookie(newCart));
    response.setHeader('Set-Cookie', cookies);
  }
}
