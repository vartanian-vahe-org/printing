'use client';

import { productionSchedule, type ProductionCalendar } from '@printing/pricing';
import { formatShopDate, orderByText } from '../../lib/schedule-text';
import { useNow } from '../../lib/use-now';
import styles from './configurator.module.css';

/**
 * "Ships by Fri, Oct 23 · Order by 2:00 PM PT today". Rendered after mount and refreshed every minute.
 */
export function ShipEstimate({ calendar, businessDays }: { calendar: ProductionCalendar; businessDays: number | null }) {
  const now = useNow();
  if (!now || !businessDays) return <p className={styles.shipEstimate}>&nbsp;</p>;
  const schedule = productionSchedule(now, businessDays, calendar);
  return (
    <p className={styles.shipEstimate}>
      Ships by <strong>{formatShopDate(schedule.shipDate)}</strong>
      <span> · order by {orderByText(schedule.orderBy, calendar.timezone, now)}</span>
    </p>
  );
}
