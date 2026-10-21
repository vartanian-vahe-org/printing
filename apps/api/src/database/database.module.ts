import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb } from '@printing/db';
import type { Pool } from 'pg';
import { config } from '../config.js';
import { DATABASE, DATABASE_POOL } from './database.tokens.js';

const CONNECTION = Symbol('DATABASE_CONNECTION');

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: CONNECTION, useFactory: () => createDb(config.databaseUrl) },
    { provide: DATABASE, useFactory: (c: ReturnType<typeof createDb>) => c.db, inject: [CONNECTION] },
    { provide: DATABASE_POOL, useFactory: (c: ReturnType<typeof createDb>) => c.pool, inject: [CONNECTION] },
    DatabaseShutdown,
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule {}
