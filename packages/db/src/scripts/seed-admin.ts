/**
 * Creates the first admin account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 * Does nothing if an account with that email already exists (never resets a password).
 * The password is never written to code, migrations or logs.
 */
import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { createDb } from '../client.js';
import { staffUsers } from '../schema/index.js';

const MIN_PASSWORD_LENGTH = 12;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing required environment variable: DATABASE_URL');

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || 'Admin';

  if (!email || !password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping admin seed');
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const { db, pool } = createDb(url, { max: 1 });
  try {
    const existing = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(sql`lower(${staffUsers.email}) = ${email}`)
      .limit(1);

    if (existing.length > 0) {
      console.log(`Admin ${email} already exists, skipping`);
      return;
    }

    await db.insert(staffUsers).values({
      email,
      name,
      passwordHash: await hash(password),
      role: 'owner',
      createdBy: 'system:seed',
    });
    console.log(`Created admin ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Admin seed failed:', err);
  process.exit(1);
});
