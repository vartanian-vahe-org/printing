import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { DATABASE_POOL } from '../database/database.tokens.js';
import { StorageService } from '../storage/storage.service.js';

type CheckStatus = 'up' | 'down';

export interface HealthResult {
  status: 'ok' | 'error';
  checks: Record<'database' | 'redis' | 'storage', { status: CheckStatus; error?: string }>;
}

@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthResult> {
    const [database, redis, storage] = await Promise.all([
      this.probe(() => this.pool.query('SELECT 1')),
      this.probe(() => this.redis.ping()),
      this.probe(() => this.storage.checkBucket()),
    ]);
    const allUp = [database, redis, storage].every((c) => c.status === 'up');
    return { status: allUp ? 'ok' : 'error', checks: { database, redis, storage } };
  }

  private async probe(fn: () => Promise<unknown>): Promise<{ status: CheckStatus; error?: string }> {
    try {
      await fn();
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
