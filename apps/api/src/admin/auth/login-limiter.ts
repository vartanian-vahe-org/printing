import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.tokens.js';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

/** The Redis commands the limiter uses (lets tests pass a small fake). */
export type LimiterStore = Pick<Redis, 'multi' | 'get' | 'ttl' | 'del'>;

/**
 * Slows down password guessing: at most 5 failed admin sign-ins per email and per IP within
 * 15 minutes of the first failure. Counted in Redis, so every API instance shares the counts and
 * a restart does not reset them (open issue A4).
 */
@Injectable()
export class LoginLimiter {
  constructor(@Inject(REDIS) private readonly redis: LimiterStore) {}

  private keys(email: string, ip: string) {
    return [`login-fail:email:${email.toLowerCase()}`, `login-fail:ip:${ip}`];
  }

  /** Seconds until another attempt is allowed, or 0 when allowed now. */
  async retryAfterSeconds(email: string, ip: string): Promise<number> {
    let wait = 0;
    for (const key of this.keys(email, ip)) {
      if (Number(await this.redis.get(key)) >= MAX_FAILURES) wait = Math.max(wait, await this.redis.ttl(key), 1);
    }
    return wait;
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    for (const key of this.keys(email, ip)) await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS, 'NX').exec();
  }

  /** A successful sign-in clears the email's count (the IP's stays, against spraying many emails). */
  async reset(email: string): Promise<void> {
    await this.redis.del(this.keys(email, '')[0]!);
  }
}
