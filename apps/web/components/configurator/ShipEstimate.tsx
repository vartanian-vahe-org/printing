'use client';

import { productionSchedule, type ProductionCalendar } from '@printing/pricing';
import { useEffect, useState } from 'react';
import { formatShopDate, orderByText } from '../../lib/schedule-text';
import styles from './configurator.module.css';

/**
 * "Ships by Fri, Oct 23 · Order by 2:00 PM PT today". Rendered after mount (the server clock and
 * the visitor's clock may straddle the cutoff) and refreshed every minute.
 */
export function ShipEstimate({ calendar, businessDays }: { calendar: ProductionCalendar; businessDays: number | null }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!now || !businessDays) return <p className={styles.shipEstimate}>&nbsp;</p>;
  const schedule = productionSchedule(now, businessDays, calendar);
  return (
    <p className={styles.shipEstimate}>
      Ships by <strong>{formatShopDate(schedule.shipDate)}</strong>
      <span> · order by {orderByText(schedule.orderBy, calendar.timezone, now)}</span>
    </p>
  );
}
