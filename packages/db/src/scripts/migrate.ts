/**
 * Applies pending migrations (schema + data/seed migrations) in order.
 * Already-applied migrations are tracked by Drizzle and never re-run.
 */
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../client.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing required environment variable: DATABASE_URL');

  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../migrations') });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
