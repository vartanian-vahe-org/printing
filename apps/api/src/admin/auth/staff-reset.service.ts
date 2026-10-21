import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { staffPasswordResets, staffUsers, storeSettings, type Database } from '@printing/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { DATABASE } from '../../database/database.tokens.js';
import { MailService } from '../../mail/mail.service.js';
import { button, escapeHtml, layout } from '../../orders/emails/layout.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../staff/passwords.js';
import { SessionService } from './session.service.js';

const LINK_MINUTES = 30;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** "Forgot password" for staff (open issue A7): a one-time link by email, 30 minutes. */
@Injectable()
export class StaffResetService {
  private readonly logger = new Logger(StaffResetService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Sends a link when an active account has this email; the caller always answers the same way. */
  async request(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const [user] = await this.db
      .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email })
      .from(staffUsers)
      .where(and(sql`lower(${staffUsers.email}) = ${email}`, eq(staffUsers.isActive, true)))
      .limit(1);
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.db.insert(staffPasswordResets).values({ tokenHash: hashToken(token), staffUserId: user.id, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });

    const [store] = await this.db.select().from(storeSettings).limit(1);
    const storeName = store?.storeName ?? 'Print shop';
    const url = `${config.adminUrl}/reset#${token}`;
    const subject = `Reset your admin password – ${storeName}`;
    const text = `Hi ${user.name}, use this link to choose a new admin password. It works once, for ${LINK_MINUTES} minutes.`;
    try {
      await this.mail.send({
        to: user.email,
        fromName: storeName,
        subject,
        text: [text, '', url, '', "Didn't ask for this? Your password stays the same. Tell the shop owner if this keeps happening."].join('\n'),
        html: layout(
          { storeName, supportEmail: store?.supportEmail ?? '' },
          subject,
          `<h1 style="font-size:22px;margin:0 0 8px;">Reset your admin password</h1><p style="margin:0;">${escapeHtml(text)}</p>${button(url, 'Choose a new password')}<p style="margin:0;font-size:13px;color:#6b6b70;">Didn't ask for this? Your password stays the same.</p>`,
          false,
        ),
      });
    } catch (err) {
      this.logger.error(`Could not send staff reset email: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async reset(token: string, password: string, ip?: string): Promise<void> {
    const staffId = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(staffPasswordResets)
        .set({ usedAt: new Date() })
        .where(and(eq(staffPasswordResets.tokenHash, hashToken(token)), isNull(staffPasswordResets.usedAt), gt(staffPasswordResets.expiresAt, new Date())))
        .returning({ staffUserId: staffPasswordResets.staffUserId });
      if (!row) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
      const [user] = await tx.select({ email: staffUsers.email }).from(staffUsers).where(eq(staffUsers.id, row.staffUserId));
      await tx.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, row.staffUserId));
      await this.audit.record(tx, row.staffUserId, { action: 'auth.password_reset', target: user?.email ?? row.staffUserId, summary: 'Reset own password with an email link' }, ip);
      return row.staffUserId;
    });
    await this.sessions.revokeAll(staffId);
  }
}
