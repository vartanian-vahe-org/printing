import { Inject, Injectable } from '@nestjs/common';
import { auditLog, staffUsers, type Database } from '@printing/db';
import { count, desc, eq, like } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface AuditEntry {
  action: string;
  target: string;
  summary: string;
  /** { before, after }; never include passwords. */
  changes?: Record<string, unknown>;
}

const PAGE_SIZE = 50;

/** Admin change history (open issue A1). Write it in the same transaction as the change. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(executor: Executor, staffId: string, entry: AuditEntry, ip?: string): Promise<void> {
    const [staff] = await executor.select({ name: staffUsers.name, email: staffUsers.email }).from(staffUsers).where(eq(staffUsers.id, staffId)).limit(1);
    await executor.insert(auditLog).values({
      staffUserId: staffId,
      actor: staff ? `${staff.name} <${staff.email}>` : staffId,
      ...entry,
      ip: ip ?? null,
    });
  }

  /** Newest first; `area` filters by action prefix ('catalog', 'staff', 'settings', 'auth'). */
  async list(page: number, area?: string) {
    const where = area ? like(auditLog.action, `${area}.%`) : undefined;
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      this.db.select({ total: count() }).from(auditLog).where(where),
    ]);
    return {
      entries: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        target: r.target,
        summary: r.summary,
        changes: r.changes,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }
}
