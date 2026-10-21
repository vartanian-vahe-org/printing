import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { RateLimiter } from './rate-limiter.js';
import { REDIS } from './redis.tokens.js';

/** Shared Redis client (rate limits). BullMQ opens its own connections. */
@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }) }, RateLimiter],
  exports: [REDIS, RateLimiter],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
