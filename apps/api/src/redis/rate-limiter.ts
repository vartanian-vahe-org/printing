import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.tokens.js';

/** Fixed-window counters in Redis, shared by every API instance. */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts one hit on `key`; 429 when more than `limit` hits fall in the current window. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    const redisKey = `rate:${key}`;
    const result = await this.redis.multi().incr(redisKey).expire(redisKey, windowSeconds, 'NX').ttl(redisKey).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    if (count > limit) {
      const retryAfter = Math.max(1, Number(result?.[2]?.[1] ?? windowSeconds));
      throw new HttpException(
        { message: `Too many requests. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`, retryAfterSeconds: retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
