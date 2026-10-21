import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { customers, customerSessions, type Database } from '@printing/db';
import { and, eq, gt, ne } from 'drizzle-orm';
import type { Request } from 'express';
import { httpOnlyCookie, readCookie } from '../common/cookies.js';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';

export const CUSTOMER_COOKIE = 'customer_session';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export interface CustomerIdentity {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export function customerToken(request: Request): string | undefined {
  return readCookie(request.headers.cookie, CUSTOMER_COOKIE);
}

export function customerCookie(token: string): string {
  return httpOnlyCookie(CUSTOMER_COOKIE, token, config.customers.sessionDays * 24 * 3600, config.cookieSecure);
}

export const clearedCustomerCookie = () => httpOnlyCookie(CUSTOMER_COOKIE, '', 0, config.cookieSecure);

/** Customer sign-in sessions (cookie token, hash stored), like the admin's. */
@Injectable()
export class CustomerSessions {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(customerId: string): Promise<string> {
    const token = newToken();
    await this.db.insert(customerSessions).values({
      tokenHash: hashToken(token),
      customerId,
      expiresAt: new Date(Date.now() + config.customers.sessionDays * 24 * 3600 * 1000),
    });
    return token;
  }

  async resolve(token: string | undefined): Promise<CustomerIdentity | null> {
    if (!token) return null;
    const [row] = await this.db
      .select({ id: customers.id, email: customers.email, name: customers.name, verifiedAt: customers.emailVerifiedAt })
      .from(customerSessions)
      .innerJoin(customers, eq(customers.id, customerSessions.customerId))
      .where(and(eq(customerSessions.tokenHash, hashToken(token)), gt(customerSessions.expiresAt, new Date())))
      .limit(1);
    return row ? { id: row.id, email: row.email, name: row.name, emailVerified: Boolean(row.verifiedAt) } : null;
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(customerSessions).where(eq(customerSessions.tokenHash, hashToken(token)));
  }

  async revokeAll(customerId: string, keepToken?: string): Promise<void> {
    await this.db
      .delete(customerSessions)
      .where(keepToken ? and(eq(customerSessions.customerId, customerId), ne(customerSessions.tokenHash, hashToken(keepToken))) : eq(customerSessions.customerId, customerId));
  }
}
