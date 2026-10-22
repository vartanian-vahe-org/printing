import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { cartItems, carts, orderEvents, orderItems, orders, payments, type Database } from '@printing/db';
import { deliveryWindow, orderTotals, type OrderTotals, type PricedShippingOption } from '@printing/pricing';
import { asc, eq } from 'drizzle-orm';
import { CartService, type CartView } from '../cart/cart.service.js';
import { ProductionCalendarService } from '../catalog/production-calendar.service.js';
import {
  PAYMENT_PROVIDER,
  SHIPPING_RATE_PROVIDER,
  TAX_PROVIDER,
  type PaymentNextStep,
  type PaymentProvider,
  type ShippingRateProvider,
  type TaxProvider,
} from '../commerce/ports.js';
import { DATABASE } from '../database/database.tokens.js';
import { OrderEmailQueue } from '../orders/order-email.queue.js';
import { PrepressService } from '../orders/prepress.service.js';
import { estimateOrderDates } from '../orders/order-dates.js';
import { hashOrderToken, orderAccessToken } from '../orders/order-link.js';
import type { CheckoutQuoteInput, PlaceOrderInput } from './checkout.schemas.js';

export type ShippingOptionWithDates = PricedShippingOption & {
  /** Estimated delivery window if the order is placed now (shop calendar dates). */
  deliveryFrom: string | null;
  deliveryTo: string | null;
};

export interface CheckoutQuote {
  cart: CartView;
  /** Empty until the customer has entered a state and ZIP. */
  shippingOptions: ShippingOptionWithDates[];
  shippingMethodCode: string | null;
  tax: { label: string; rateBps: number; taxCents: number } | null;
  totals: OrderTotals;
  payment: { provider: string; note: string };
  /** True when an order can be placed with these totals. */
  ready: boolean;
}

export interface PlacedOrder {
  number: number;
  /** Secret for the order page link; only its hash is stored. */
  accessToken: string;
  totalCents: number;
  next: PaymentNextStep;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly carts: CartService,
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
    @Inject(SHIPPING_RATE_PROVIDER) private readonly shipping: ShippingRateProvider,
    @Inject(TAX_PROVIDER) private readonly tax: TaxProvider,
    private readonly emails: OrderEmailQueue,
    private readonly calendars: ProductionCalendarService,
    private readonly prepress: PrepressService,
  ) {}

  /** Live totals for the checkout page. Nothing is saved. */
  async quote(cartId: string | null, input: CheckoutQuoteInput): Promise<CheckoutQuote> {
    const cart = await this.carts.view(cartId);
    if (cart.items.length === 0) throw new BadRequestException('Your cart is empty');

    const address = input.address;
    const calendar = await this.calendars.calendar();
    const rates = address ? await this.shipping.rates({ address, subtotalCents: cart.subtotalCents }) : [];
    const shippingOptions: ShippingOptionWithDates[] = rates.map((option) => {
      const window = cart.shipDate ? deliveryWindow(cart.shipDate, option.transitDaysMin, option.transitDaysMax, calendar) : null;
      return { ...option, deliveryFrom: window?.from ?? null, deliveryTo: window?.to ?? null };
    });
    const method = shippingOptions.find((o) => o.code === input.shippingMethodCode) ?? shippingOptions[0] ?? null;
    const tax =
      address && method
        ? await this.tax.calculate({ address, subtotalCents: cart.subtotalCents, shippingCents: method.priceCents })
        : null;

    return {
      cart,
      shippingOptions,
      shippingMethodCode: method?.code ?? null,
      tax: tax && { label: tax.label, rateBps: tax.rateBps, taxCents: tax.taxCents },
      totals: orderTotals(cart.subtotalCents, method?.priceCents ?? 0, tax?.taxCents ?? 0),
      payment: { provider: this.payment.code, note: this.payment.checkoutNote },
      ready: Boolean(method && tax) && !cart.hasUnavailableItems,
    };
  }

  /**
   * Turns the cart into an order. Everything is priced again on the server; the order is refused
   * when the total differs from what the customer saw. The cart row is locked so a double submit
   * cannot create two orders (the second one finds the cart empty).
   */
  async placeOrder(cartId: string | null, input: PlaceOrderInput, customerId: string | null = null): Promise<PlacedOrder> {
    if (!cartId) throw new BadRequestException('Your cart is empty');

    const placed = await this.db.transaction(async (tx) => {
      await tx.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).for('update');
      const rows = await tx.select().from(cartItems).where(eq(cartItems.cartId, cartId)).orderBy(asc(cartItems.createdAt));
      if (rows.length === 0) throw new BadRequestException('Your cart is empty');

      const items = await this.carts.checkoutItems(rows);
      const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      const address = input.shippingAddress;

      const options = await this.shipping.rates({ address, subtotalCents });
      const method = options.find((o) => o.code === input.shippingMethodCode);
      if (!method) {
        throw new ConflictException({ message: 'This shipping method is not available. Please choose another one.', code: 'shipping_unavailable' });
      }
      const tax = await this.tax.calculate({ address, subtotalCents, shippingCents: method.priceCents });
      const totals = orderTotals(subtotalCents, method.priceCents, tax.taxCents);
      // The order ships when its slowest item is printed; designed-for-you items need their first draft first.
      const productionDays = Math.max(...items.map((item) => item.turnaroundDays + (item.designService?.designDays ?? 0)));
      const dates = estimateOrderDates(new Date(), productionDays, method, await this.calendars.calendar());
      if (totals.totalCents !== input.expectedTotalCents) {
        throw new ConflictException({
          message: 'Your order total changed. Please review it before placing your order.',
          code: 'total_changed',
          totals,
        });
      }

      // The id is chosen here because the order link token is derived from it.
      const orderId = randomUUID();
      const accessToken = orderAccessToken(orderId);
      const [order] = await tx
        .insert(orders)
        .values({
          id: orderId,
          email: input.email,
          customerId,
          shippingAddress: address,
          shippingMethod: {
            code: method.code,
            label: method.label,
            priceCents: method.priceCents,
            isFree: method.isFree,
            transitDaysMin: method.transitDaysMin,
            transitDaysMax: method.transitDaysMax,
            provider: this.shipping.code,
          },
          tax: { provider: tax.provider, state: address.state, rateBps: tax.rateBps, label: tax.label },
          ...totals,
          ...dates,
          accessTokenHash: hashOrderToken(accessToken),
        })
        .returning({ id: orders.id, number: orders.number });

      await tx.insert(orderItems).values(
        items.map((item) => ({
          orderId: order!.id,
          productCode: item.productCode,
          productName: item.productName,
          configuration: item.configuration,
          design: item.design,
          // Snapshot plus what later steps need: the summary to display, the turnaround to reschedule,
          // the design package bought (fee, rounds of changes included).
          quote: { ...item.quote, summary: item.summary, turnaroundDays: item.turnaroundDays, designService: item.designService },
          printSpec: item.printSpec as unknown as Record<string, unknown>,
          quantity: item.quote.quantity,
          totalCents: item.totalCents,
          // Our designer makes the file first; the file check runs once it is delivered.
          ...(item.designService ? { proofStatus: 'awaiting_design' } : {}),
        })),
      );

      await tx.insert(orderEvents).values({
        orderId,
        type: 'placed',
        message: `Order placed online (${items.length} item${items.length === 1 ? '' : 's'})`,
        createdBy: 'customer',
      });

      const start = await this.payment.start({
        orderId: order!.id,
        orderNumber: order!.number,
        amountCents: totals.totalCents,
        email: input.email,
      });
      await tx.insert(payments).values({
        orderId: order!.id,
        provider: this.payment.code,
        status: start.status,
        amountCents: totals.totalCents,
        reference: start.reference,
      });
      if (start.status === 'succeeded') {
        await tx.update(orders).set({ paymentStatus: 'paid', paidAt: new Date() }).where(eq(orders.id, order!.id));
      }

      await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
      return { orderId, number: order!.number, accessToken, totalCents: totals.totalCents, next: start.next };
    });

    // After commit: the order stands even if the queue is down (the email is then lost, open issue S16).
    await this.emails.orderPlaced(placed.orderId).catch((err: unknown) =>
      this.logger.error(`Could not queue emails for order #${placed.number}: ${err instanceof Error ? err.message : String(err)}`),
    );
    // File check and proof run in the background; the customer is emailed when proofs are ready.
    void this.prepress
      .queueOrder(placed.orderId)
      .catch((err: unknown) => this.logger.error(`Could not queue the file check for order #${placed.number}: ${err instanceof Error ? err.message : String(err)}`));
    const { orderId: _orderId, ...result } = placed;
    return result;
  }
}
