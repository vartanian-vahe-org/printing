import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { staffUsers, storeSettings, type Database } from '@printing/db';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { openSecret, sealSecret } from '../../common/secret-box.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../common/totp.js';
import { config } from '../../config.js';
import { DATABASE } from '../../database/database.tokens.js';
import { REDIS } from '../../redis/redis.tokens.js';
import { AuditService } from '../audit/audit.service.js';

const SETUP_SECONDS = 10 * 60;
const CHALLENGE_SECONDS = 5 * 60;
const MAX_CODE_ATTEMPTS = 5;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Two-step admin sign-in with an authenticator app (open issue A8). Optional per person; the
 * secret is stored encrypted, each code works once, and a sign-in challenge allows 5 tries.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  /** Step 1 of turning it on: a new secret to scan, kept aside until a code confirms it. */
  async startSetup(staffId: string, email: string): Promise<{ secret: string; otpauthUri: string }> {
    const secret = generateTotpSecret();
    await this.redis.set(`totp-setup:${staffId}`, sealSecret(secret, config.dataEncryptionKey), 'EX', SETUP_SECONDS);
    const [store] = await this.db.select({ name: storeSettings.storeName }).from(storeSettings).limit(1);
    return { secret, otpauthUri: otpauthUri(`${store?.name ?? 'Print shop'} Admin`, email, secret) };
  }

  /** Step 2: the first code from the app proves the scan worked; 2FA is on from now. */
  async confirmSetup(staffId: string, code: string, ip?: string): Promise<void> {
    const sealed = await this.redis.get(`totp-setup:${staffId}`);
    if (!sealed) throw new BadRequestException('The setup expired. Start again.');
    const counter = verifyTotp(openSecret(sealed, config.dataEncryptionKey), code, Date.now());
    if (counter === null) throw new BadRequestException('That code is not right. Check the time on your phone and try the newest code.');
    await this.db.transaction(async (tx) => {
      const [user] = await tx.update(staffUsers).set({ totpSecret: sealed, totpEnabledAt: new Date() }).where(eq(staffUsers.id, staffId)).returning({ email: staffUsers.email });
      await this.audit.record(tx, staffId, { action: 'auth.2fa_enable', target: user?.email ?? staffId, summary: 'Turned on two-step sign-in' }, ip);
    });
    await this.redis.del(`totp-setup:${staffId}`);
    await this.markUsed(staffId, counter);
  }

  /** Turning it off needs the password and a current code. */
  async disable(staffId: string, password: string, code: string, ip?: string): Promise<void> {
    const [user] = await this.db.select().from(staffUsers).where(eq(staffUsers.id, staffId)).limit(1);
    if (!user?.totpSecret) throw new ConflictException('Two-step sign-in is not on.');
    if (!(await verify(user.passwordHash, password).catch(() => false))) throw new UnauthorizedException('Your password is incorrect');
    if (!(await this.checkCode(user.id, user.totpSecret, code))) throw new BadRequestException('That code is not right.');
    await this.clear(staffId, staffId, 'Turned off two-step sign-in', ip);
  }

  /** The owner turns it off for someone who lost their phone. */
  async resetFor(targetId: string, ownerId: string, ip?: string): Promise<void> {
    const [user] = await this.db.select({ email: staffUsers.email, totpSecret: staffUsers.totpSecret }).from(staffUsers).where(eq(staffUsers.id, targetId));
    if (!user) throw new NotFoundException('Staff account not found');
    if (!user.totpSecret) throw new ConflictException('Two-step sign-in is not on for this account.');
    await this.clear(targetId, ownerId, `Turned off two-step sign-in for ${user.email}`, ip);
  }

  // ---------------------------------------------------------------- sign-in

  /** After a correct password: a short-lived challenge the second step must present. */
  async createChallenge(staffId: string): Promise<string> {
    const challenge = randomBytes(24).toString('base64url');
    await this.redis.set(`login-2fa:${hashToken(challenge)}`, JSON.stringify({ staffId, attempts: 0 }), 'EX', CHALLENGE_SECONDS);
    return challenge;
  }

  /** The staff id when the code fits the challenge; the challenge is used up on success or after 5 tries. */
  async completeChallenge(challenge: string, code: string): Promise<string> {
    const key = `login-2fa:${hashToken(challenge)}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new UnauthorizedException('This sign-in expired. Enter your password again.');
    const state = JSON.parse(raw) as { staffId: string; attempts: number };
    const [user] = await this.db.select({ secret: staffUsers.totpSecret, isActive: staffUsers.isActive }).from(staffUsers).where(eq(staffUsers.id, state.staffId));
    if (!user?.secret || !user.isActive) throw new UnauthorizedException('This sign-in expired. Enter your password again.');

    if (!(await this.checkCode(state.staffId, user.secret, code))) {
      state.attempts += 1;
      if (state.attempts >= MAX_CODE_ATTEMPTS) {
        await this.redis.del(key);
        throw new HttpException('Too many wrong codes. Enter your password again.', HttpStatus.TOO_MANY_REQUESTS);
      }
      await this.redis.set(key, JSON.stringify(state), 'KEEPTTL');
      throw new UnauthorizedException('That code is not right.');
    }
    await this.redis.del(key);
    return state.staffId;
  }

  // ---------------------------------------------------------------- helpers

  /** A code is accepted once: replaying a seen code (e.g. shoulder-surfed) fails. */
  private async checkCode(staffId: string, sealed: string, code: string): Promise<boolean> {
    const counter = verifyTotp(openSecret(sealed, config.dataEncryptionKey), code, Date.now());
    if (counter === null) return false;
    return this.markUsed(staffId, counter);
  }

  private async markUsed(staffId: string, counter: number): Promise<boolean> {
    return (await this.redis.set(`totp-used:${staffId}:${counter}`, '1', 'EX', 120, 'NX')) === 'OK';
  }

  private async clear(targetId: string, actorId: string, summary: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.update(staffUsers).set({ totpSecret: null, totpEnabledAt: null }).where(eq(staffUsers.id, targetId)).returning({ email: staffUsers.email });
      await this.audit.record(tx, actorId, { action: 'auth.2fa_disable', target: user?.email ?? targetId, summary }, ip);
    });
  }
}
