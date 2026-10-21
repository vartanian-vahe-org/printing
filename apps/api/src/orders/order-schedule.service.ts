import { Injectable } from '@nestjs/common';
import { orderItems, orders, type Database } from '@printing/db';
import { eq } from 'drizzle-orm';
import { ProductionCalendarService } from '../catalog/production-calendar.service.js';
import { estimateOrderDates, type OrderDates } from './order-dates.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type OrderRow = typeof orders.$inferSelect;

/**
 * Production can start once an order is paid and every proof is approved (spec §5); each of those
 * events moves the ship and delivery estimates to "starting now".
 */
@Injectable()
export class OrderScheduleService {
  constructor(private readonly calendars: ProductionCalendarService) {}

  /** New estimates from `now`, using the turnaround stored on the items; null for orders without one. */
  async datesFrom(tx: Tx, order: OrderRow, now: Date): Promise<OrderDates | null> {
    const items = await tx.select({ quote: orderItems.quote }).from(orderItems).where(eq(orderItems.orderId, order.id));
    const days = items.map((i) => Number((i.quote as { turnaroundDays?: number }).turnaroundDays ?? 0));
    if (days.length === 0 || days.some((d) => !d)) return null;
    const method = order.shippingMethod as { transitDaysMin: number; transitDaysMax: number };
    return estimateOrderDates(now, Math.max(...days), method, await this.calendars.calendar());
  }
}
