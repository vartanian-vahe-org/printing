import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { type Database, staffUsers } from '@printing/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { config } from '../../config.js';
import { DATABASE } from '../../database/database.tokens.js';
import { AdminGuard, type AdminRequest } from './admin.guard.js';
import { AllowStaff } from './allow-staff.decorator.js';
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from './cookies.js';
import { LoginLimiter } from './login-limiter.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword, passwordSchema } from '../staff/passwords.js';
import { SessionService } from './session.service.js';
import { StaffResetService } from './staff-reset.service.js';
import { TwoFactorService } from './two-factor.service.js';
import { RateLimiter } from '../../redis/rate-limiter.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
type LoginBody = z.infer<typeof loginSchema>;

/** Real hash of a random password: verifying against it keeps timing similar for unknown emails. */
let dummyHash: Promise<string> | null = null;
const verifySchema = z.object({ challenge: z.string().min(20).max(100), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict();
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict();
const disableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }).strict();
const forgotSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) }).strict();
const resetSchema = z.object({ token: z.string().min(20).max(100), newPassword: passwordSchema }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();

const getDummyHash = () => (dummyHash ??= hash(randomBytes(16).toString('hex')));

@Controller('admin/auth')
export class AuthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly limiter: LoginLimiter,
    private readonly audit: AuditService,
    private readonly resets: StaffResetService,
    private readonly rateLimiter: RateLimiter,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Emails a reset link if an active account uses this email; same answer either way. */
  @Post('password/forgot')
  @HttpCode(202)
  async forgotPassword(@Body(new ZodValidationPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() request: AdminRequest) {
    await this.rateLimiter.consume(`admin-forgot:ip:${request.ip}`, 10, 3600);
    await this.rateLimiter.consume(`admin-forgot:email:${body.email}`, 5, 3600);
    await this.resets.request(body.email);
    return { message: 'If an account uses this email, we sent a link to reset the password.' };
  }

  @Post('password/reset')
  @HttpCode(204)
  async resetPassword(@Body(new ZodValidationPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Req() request: AdminRequest) {
    await this.rateLimiter.consume(`admin-reset:ip:${request.ip}`, 20, 3600);
    await this.resets.reset(body.token, body.newPassword, request.ip);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ip = request.ip ?? 'unknown';
    const wait = await this.limiter.retryAfterSeconds(body.email, ip);
    if (wait > 0) {
      response.setHeader('Retry-After', String(wait));
      throw new HttpException('Too many failed sign-in attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const [user] = await this.db
      .select()
      .from(staffUsers)
      .where(and(sql`lower(${staffUsers.email}) = ${body.email}`, eq(staffUsers.isActive, true)))
      .limit(1);
    const valid = await verify(user?.passwordHash ?? (await getDummyHash()), body.password).catch(() => false);
    if (!user || !valid) {
      await this.limiter.recordFailure(body.email, ip);
      throw new UnauthorizedException('Email or password is incorrect');
    }

    await this.limiter.reset(body.email);
    // Two-step sign-in on: no session yet, the second step needs a code from the app.
    if (user.totpEnabledAt) return { twoFactorRequired: true, challenge: await this.twoFactor.createChallenge(user.id) };
    return this.startSession(user.id, request, response);
  }

  /** Second step of sign-in: the code from the authenticator app. */
  @Post('login/verify')
  @HttpCode(200)
  async loginVerify(@Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    await this.rateLimiter.consume(`admin-2fa:ip:${request.ip}`, 30, 900);
    const staffId = await this.twoFactor.completeChallenge(body.challenge, body.code);
    return this.startSession(staffId, request, response);
  }

  @Post('2fa/setup')
  @UseGuards(AdminGuard)
  @AllowStaff()
  setupTwoFactor(@Req() request: AdminRequest) {
    return this.twoFactor.startSetup(request.staff!.id, request.staff!.email);
  }

  @Post('2fa/enable')
  @UseGuards(AdminGuard)
  @AllowStaff()
  @HttpCode(204)
  async enableTwoFactor(@Body(new ZodValidationPipe(codeSchema)) body: z.infer<typeof codeSchema>, @Req() request: AdminRequest) {
    await this.twoFactor.confirmSetup(request.staff!.id, body.code, request.ip);
  }

  @Post('2fa/disable')
  @UseGuards(AdminGuard)
  @AllowStaff()
  @HttpCode(204)
  async disableTwoFactor(@Body(new ZodValidationPipe(disableSchema)) body: z.infer<typeof disableSchema>, @Req() request: AdminRequest) {
    await this.twoFactor.disable(request.staff!.id, body.password, body.code, request.ip);
  }

  private async startSession(staffId: string, request: AdminRequest, response: Response) {
    const [user] = await this.db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, staffId)).returning();
    const token = await this.sessions.create(staffId, config.admin.sessionDays, { userAgent: request.headers['user-agent'], ip: request.ip ?? 'unknown' });
    response.setHeader('Set-Cookie', sessionCookie(token, config.admin.sessionDays * 24 * 60 * 60, config.cookieSecure));
    return { user: { email: user!.email, name: user!.name, role: user!.role, twoFactorEnabled: Boolean(user!.totpEnabledAt) } };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.revoke(token);
    response.setHeader('Set-Cookie', clearedSessionCookie(config.cookieSecure));
  }

  /** Any signed-in user changes their own password; their other sessions are signed out. */
  @Post('password')
  @UseGuards(AdminGuard)
  @AllowStaff()
  @HttpCode(204)
  async changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @Req() request: AdminRequest) {
    const staffId = request.staff!.id;
    const [user] = await this.db.select({ passwordHash: staffUsers.passwordHash }).from(staffUsers).where(eq(staffUsers.id, staffId)).limit(1);
    if (!user || !(await verify(user.passwordHash, body.currentPassword).catch(() => false))) {
      throw new UnauthorizedException('Your current password is incorrect');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(staffUsers).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(staffUsers.id, staffId));
      await this.audit.record(tx, staffId, { action: 'auth.password_change', target: request.staff!.email, summary: 'Changed own password' }, request.ip);
    });
    await this.sessions.revokeAll(staffId, readCookie(request.headers.cookie, SESSION_COOKIE));
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async me(@Req() request: AdminRequest) {
    const { id, email, name, role } = request.staff!;
    const [row] = await this.db.select({ totpEnabledAt: staffUsers.totpEnabledAt }).from(staffUsers).where(eq(staffUsers.id, id));
    return { user: { email, name, role, twoFactorEnabled: Boolean(row?.totpEnabledAt) } };
  }
}
