import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { customers, customerTokens, orderItems, orders, storeSettings, type Database } from '@printing/db';
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { CartService } from '../cart/cart.service.js';
import type { Design } from '../cart/cart.schemas.js';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';
import { MailService } from '../mail/mail.service.js';
import { orderAccessToken } from '../orders/order-link.js';
import { proofProgress } from '../orders/orders.service.js';
import type { RenderedEmail } from '../orders/emails/layout.js';
import { resetPasswordEmail, verifyEmailEmail } from './account-emails.js';
import { CustomerSessions, hashToken, newToken, type CustomerIdentity } from './customer-session.js';

type Purpose = 'verify_email' | 'reset_password';

let dummyHash: Promise<string> | undefined;
/** Same work for unknown emails, so response times do not reveal which emails have accounts. */
const getDummyHash = () => (dummyHash ??= hash(newToken()));

/**
 * Customer accounts (Phase 2 step 10, spec §6.1). Orders placed with the account's email join it
 * once the email is verified (by the verification link, or by resetting the password, which also
 * proves the customer reads that inbox).
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sessions: CustomerSessions,
    private readonly carts: CartService,
    private readonly mail: MailService,
  ) {}

  async register(input: { email: string; name: string; password: string }): Promise<{ customerId: string; sessionToken: string }> {
    const email = input.email.trim().toLowerCase();
    const [taken] = await this.db.select({ id: customers.id }).from(customers).where(sql`lower(${customers.email}) = ${email}`).limit(1);
    if (taken) throw new ConflictException('An account with this email already exists. Sign in, or reset your password.');
    const [customer] = await this.db
      .insert(customers)
      .values({ email, name: input.name.trim(), passwordHash: await hash(input.password), lastLoginAt: new Date() })
      .returning({ id: customers.id });
    await this.sendVerification(customer!.id);
    return { customerId: customer!.id, sessionToken: await this.sessions.create(customer!.id) };
  }

  async signIn(emailInput: string, password: string): Promise<{ customerId: string; sessionToken: string }> {
    const email = emailInput.trim().toLowerCase();
    const [customer] = await this.db.select().from(customers).where(sql`lower(${customers.email}) = ${email}`).limit(1);
    const valid = await verify(customer?.passwordHash ?? (await getDummyHash()), password).catch(() => false);
    if (!customer || !valid) throw new UnauthorizedException('Email or password is incorrect');
    await this.db.update(customers).set({ lastLoginAt: new Date() }).where(eq(customers.id, customer.id));
    return { customerId: customer.id, sessionToken: await this.sessions.create(customer.id) };
  }

  async profile(customer: CustomerIdentity) {
    // The last shipping address prefills checkout.
    const [last] = await this.db
      .select({ address: orders.shippingAddress })
      .from(orders)
      .where(eq(orders.customerId, customer.id))
      .orderBy(desc(orders.placedAt))
      .limit(1);
    return { customer: { ...customer, lastShippingAddress: last?.address ?? null } };
  }

  async updateName(customerId: string, name: string): Promise<void> {
    await this.db.update(customers).set({ name: name.trim() }).where(eq(customers.id, customerId));
  }

  /** Signed-in password change: needs the current password; other devices are signed out. */
  async changePassword(customerId: string, current: string, next: string, keepSession: string | undefined): Promise<void> {
    const [customer] = await this.db.select({ passwordHash: customers.passwordHash }).from(customers).where(eq(customers.id, customerId));
    if (!customer || !(await verify(customer.passwordHash, current).catch(() => false))) {
      throw new UnauthorizedException('Your current password is incorrect');
    }
    await this.db.update(customers).set({ passwordHash: await hash(next) }).where(eq(customers.id, customerId));
    await this.sessions.revokeAll(customerId, keepSession);
  }

  /** Emails a verification link (72 h). Safe to call again: older links stay valid until they expire. */
  async sendVerification(customerId: string): Promise<void> {
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer || customer.emailVerifiedAt) return;
    const token = await this.issueToken(customerId, 'verify_email', config.customers.verifyLinkHours * 3600);
    await this.send(customer.email, (store) => verifyEmailEmail(customer.name, store, `${config.webUrl}/account/verify#${token}`));
  }

  async verifyEmail(token: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const customerId = await this.useToken(tx, token, 'verify_email');
      await tx.update(customers).set({ emailVerifiedAt: new Date() }).where(and(eq(customers.id, customerId), isNull(customers.emailVerifiedAt)));
      await this.attachOrders(tx, customerId);
    });
  }

  /** Always succeeds from the caller's view, so it cannot be used to find out who has an account. */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const [customer] = await this.db.select().from(customers).where(sql`lower(${customers.email}) = ${email}`).limit(1);
    if (!customer) return;
    const minutes = config.customers.resetLinkMinutes;
    const token = await this.issueToken(customer.id, 'reset_password', minutes * 60);
    await this.send(customer.email, (store) => resetPasswordEmail(store, `${config.webUrl}/account/reset#${token}`, minutes));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const customerId = await this.db.transaction(async (tx) => {
      const id = await this.useToken(tx, token, 'reset_password');
      // The link reached this inbox, so the email is verified too.
      await tx.update(customers).set({ passwordHash: await hash(password), emailVerifiedAt: sql`coalesce(${customers.emailVerifiedAt}, now())` }).where(eq(customers.id, id));
      await this.attachOrders(tx, id);
      return id;
    });
    await this.sessions.revokeAll(customerId);
  }

  async orders(customerId: string) {
    const rows = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        placedAt: orders.placedAt,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        totalCents: orders.totalCents,
        deliverFrom: orders.deliverFrom,
        deliverTo: orders.deliverTo,
      })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.placedAt))
      .limit(100);
    const itemRows = rows.length
      ? await this.db
          .select({ orderId: orderItems.orderId, productName: orderItems.productName, quantity: orderItems.quantity, proofStatus: orderItems.proofStatus })
          .from(orderItems)
          .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
          .orderBy(asc(orderItems.createdAt))
      : [];
    return {
      orders: rows.map(({ id, ...order }) => {
        const items = itemRows.filter((i) => i.orderId === id);
        return {
          ...order,
          placedAt: order.placedAt.toISOString(),
          items: items.map((i) => ({ productName: i.productName, quantity: i.quantity })),
          proofStatus: proofProgress(items.map((i) => i.proofStatus)),
          // The customer owns the order: give them its private page.
          orderPath: `/orders/${order.number}#${orderAccessToken(id)}`,
        };
      }),
    };
  }

  /**
   * "Order again": every item of a past order back into the cart, checked and priced like a new
   * add. Items that cannot be ordered as they were (option retired, file gone) are skipped and listed.
   */
  async reorder(customerId: string, orderNumber: number, cartToken: string | undefined): Promise<{ added: number; skipped: string[]; newCartToken: string | null }> {
    const [order] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.number, orderNumber), eq(orders.customerId, customerId))).limit(1);
    if (!order) throw new NotFoundException('Order not found');
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(orderItems.createdAt);

    let cartId = await this.carts.findCart(cartToken);
    let newCartToken: string | null = null;
    let added = 0;
    const skipped: string[] = [];
    for (const item of items) {
      try {
        const prepared = await this.carts.prepareItem({
          productCode: item.productCode,
          configuration: item.configuration as never,
          design: item.design as unknown as Design,
        });
        if (!cartId) {
          const created = await this.carts.createCart(customerId);
          cartId = created.cartId;
          newCartToken = created.token;
        }
        await this.carts.addItem(cartId, prepared);
        added++;
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        const body = err.getResponse() as { message?: string; issues?: string[] } | string;
        const reason = typeof body === 'string' ? body : (body.issues?.join(' ') ?? body.message ?? 'not available');
        skipped.push(`${item.productName} × ${item.quantity}: ${reason}`);
      }
    }
    if (added === 0 && skipped.length) throw new BadRequestException({ message: 'None of these items can be ordered again as they were.', issues: skipped });
    return { added, skipped, newCartToken };
  }

  // ---------------------------------------------------------------- helpers

  /** Verified email: past guest orders with that email join the account. */
  private async attachOrders(tx: Parameters<Parameters<Database['transaction']>[0]>[0], customerId: string) {
    const [customer] = await tx.select({ email: customers.email }).from(customers).where(eq(customers.id, customerId));
    if (!customer) return;
    await tx
      .update(orders)
      .set({ customerId })
      .where(and(isNull(orders.customerId), sql`lower(${orders.email}) = ${customer.email.toLowerCase()}`));
  }

  private async issueToken(customerId: string, purpose: Purpose, seconds: number): Promise<string> {
    // At most 5 live links per purpose, so the table cannot be flooded through the API.
    const [{ live } = { live: 0 }] = await this.db
      .select({ live: count() })
      .from(customerTokens)
      .where(and(eq(customerTokens.customerId, customerId), eq(customerTokens.purpose, purpose), isNull(customerTokens.usedAt), gt(customerTokens.expiresAt, new Date())));
    if (live >= 5) throw new HttpException('Too many links requested. Use the latest email, or try again later.', 429);
    const token = newToken();
    await this.db.insert(customerTokens).values({ tokenHash: hashToken(token), customerId, purpose, expiresAt: new Date(Date.now() + seconds * 1000) });
    return token;
  }

  private async useToken(tx: Parameters<Parameters<Database['transaction']>[0]>[0], token: string, purpose: Purpose): Promise<string> {
    const [row] = await tx
      .update(customerTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(customerTokens.tokenHash, hashToken(token)), eq(customerTokens.purpose, purpose), isNull(customerTokens.usedAt), gt(customerTokens.expiresAt, new Date())))
      .returning({ customerId: customerTokens.customerId });
    if (!row) throw new BadRequestException('This link has expired or was already used. Ask for a new one.');
    return row.customerId;
  }

  private async send(to: string, render: (store: { storeName: string; supportEmail: string }) => RenderedEmail) {
    const [store] = await this.db.select().from(storeSettings).limit(1);
    const identity = { storeName: store?.storeName ?? 'Print shop', supportEmail: store?.supportEmail ?? '' };
    try {
      await this.mail.send({ to, ...render(identity), fromName: identity.storeName, replyTo: identity.supportEmail || undefined });
    } catch (err) {
      // The account works without the email; the customer can ask for the link again.
      this.logger.error(`Could not send account email: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
