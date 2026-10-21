import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Database, staffSessions, staffUsers } from '@printing/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';

export interface StaffIdentity {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Refresh last_seen_at at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(staffUserId: string, days: number, meta: { userAgent?: string; ip?: string }): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(staffSessions).values({
      tokenHash: hashToken(token),
      staffUserId,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
    });
    await this.db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, staffUserId));
    return token;
  }

  /** The active staff user for a session token, or null when missing, expired or deactivated. */
  async resolve(token: string): Promise<StaffIdentity | null> {
    const [row] = await this.db
      .select({
        sessionId: staffSessions.id,
        lastSeenAt: staffSessions.lastSeenAt,
        id: staffUsers.id,
        email: staffUsers.email,
        name: staffUsers.name,
        role: staffUsers.role,
      })
      .from(staffSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
      .where(
        and(
          eq(staffSessions.tokenHash, hashToken(token)),
          gt(staffSessions.expiresAt, sql`now()`),
          eq(staffUsers.isActive, true),
        ),
      )
      .limit(1);
    if (!row) return null;

    if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.db.update(staffSessions).set({ lastSeenAt: new Date() }).where(eq(staffSessions.id, row.sessionId));
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role as StaffIdentity['role'] };
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(staffSessions).where(eq(staffSessions.tokenHash, hashToken(token)));
  }
}
