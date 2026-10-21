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
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from './cookies.js';
import { LoginLimiter } from './login-limiter.js';
import { SessionService } from './session.service.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});
type LoginBody = z.infer<typeof loginSchema>;

/** Real hash of a random password: verifying against it keeps timing similar for unknown emails. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hash(randomBytes(16).toString('hex')));

@Controller('admin/auth')
export class AuthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly limiter: LoginLimiter,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ip = request.ip ?? 'unknown';
    const wait = this.limiter.retryAfterSeconds(body.email, ip);
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
      this.limiter.recordFailure(body.email, ip);
      throw new UnauthorizedException('Email or password is incorrect');
    }

    this.limiter.reset(body.email);
    const token = await this.sessions.create(user.id, config.admin.sessionDays, {
      userAgent: request.headers['user-agent'],
      ip,
    });
    response.setHeader(
      'Set-Cookie',
      sessionCookie(token, config.admin.sessionDays * 24 * 60 * 60, config.admin.cookieSecure),
    );
    return { user: { email: user.email, name: user.name, role: user.role } };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await this.sessions.revoke(token);
    response.setHeader('Set-Cookie', clearedSessionCookie(config.admin.cookieSecure));
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@Req() request: AdminRequest) {
    const { email, name, role } = request.staff!;
    return { user: { email, name, role } };
  }
}
