import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { staffUsers, type Database } from '@printing/db';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService, type StaffIdentity } from '../auth/session.service.js';
import { hashPassword } from './passwords.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Role = StaffIdentity['role'];

export interface StaffCreate {
  email: string;
  name: string;
  role: Role;
  password: string;
}

export interface StaffPatch {
  name?: string;
  role?: Role;
  isActive?: boolean;
}

/** Staff accounts (open issue A2). Only the owner calls these (controller). */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.db.select().from(staffUsers).orderBy(asc(staffUsers.createdAt));
    return {
      staff: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        twoFactorEnabled: Boolean(u.totpEnabledAt),
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  async create(input: StaffCreate, actorId: string, ip?: string) {
    const email = input.email.trim().toLowerCase();
    return this.db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: staffUsers.id }).from(staffUsers).where(sql`lower(${staffUsers.email}) = ${email}`).limit(1);
      if (taken) throw new ConflictException('An account with this email already exists');
      const [user] = await tx
        .insert(staffUsers)
        .values({ email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password), createdBy: actorId })
        .returning({ id: staffUsers.id });
      await this.audit.record(
        tx,
        actorId,
        { action: 'staff.create', target: email, summary: `Added ${input.name.trim()} as ${input.role}`, changes: { after: { email, name: input.name.trim(), role: input.role } } },
        ip,
      );
      return { id: user!.id };
    });
  }

  async update(id: string, patch: StaffPatch, actorId: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).for('update');
      if (!user) throw new NotFoundException('Staff account not found');
      const losesOwner = user.role === 'owner' && user.isActive && ((patch.role && patch.role !== 'owner') || patch.isActive === false);
      if (losesOwner) await this.assertAnotherOwner(tx, id);

      const changes: Partial<typeof staffUsers.$inferInsert> = {};
      if (patch.name !== undefined) changes.name = patch.name.trim();
      if (patch.role !== undefined) changes.role = patch.role;
      if (patch.isActive !== undefined) changes.isActive = patch.isActive;
      if (Object.keys(changes).length === 0) throw new BadRequestException('Nothing to update');
      await tx.update(staffUsers).set(changes).where(eq(staffUsers.id, id));

      const before = { name: user.name, role: user.role, isActive: user.isActive };
      const after = { ...before, ...changes };
      const what = [
        changes.role && changes.role !== user.role ? `role ${user.role} → ${changes.role}` : null,
        changes.isActive === false && user.isActive ? 'disabled' : null,
        changes.isActive === true && !user.isActive ? 'enabled' : null,
        changes.name && changes.name !== user.name ? `renamed to ${changes.name}` : null,
      ].filter(Boolean);
      await this.audit.record(tx, actorId, { action: 'staff.update', target: user.email, summary: `${user.name}: ${what.join(', ') || 'no change'}`, changes: { before, after } }, ip);
    });
    // A disabled account or a new role takes effect at once: sign the user out.
    if (patch.isActive === false || patch.role !== undefined) await this.sessions.revokeAll(id);
  }

  async resetPassword(id: string, password: string, actorId: string, ip?: string) {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select({ email: staffUsers.email, name: staffUsers.name }).from(staffUsers).where(eq(staffUsers.id, id));
      if (!user) throw new NotFoundException('Staff account not found');
      await tx.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, id));
      await this.audit.record(tx, actorId, { action: 'staff.password_reset', target: user.email, summary: `Set a new password for ${user.name}` }, ip);
    });
    await this.sessions.revokeAll(id);
  }

  /** The shop must keep at least one active owner, or nobody can manage accounts. */
  private async assertAnotherOwner(tx: Tx, exceptId: string) {
    const [other] = await tx
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.role, 'owner'), eq(staffUsers.isActive, true), ne(staffUsers.id, exceptId)))
      .limit(1);
    if (!other) throw new ConflictException('This is the only active owner. Make someone else an owner first.');
  }
}
