import { deliveryWindow, productionSchedule, type ProductionCalendar } from '@printing/pricing';

export interface OrderDates {
  shipBy: string;
  deliverFrom: string;
  deliverTo: string;
}

/** Ship day and delivery window if production can start at `now` (see @printing/pricing schedule). */
export function estimateOrderDates(
  now: Date,
  productionDays: number,
  method: { transitDaysMin: number; transitDaysMax: number },
  calendar: ProductionCalendar,
): OrderDates {
  const { shipDate } = productionSchedule(now, productionDays, calendar);
  const window = deliveryWindow(shipDate, method.transitDaysMin, method.transitDaysMax, calendar);
  return { shipBy: shipDate, deliverFrom: window.from, deliverTo: window.to };
}
