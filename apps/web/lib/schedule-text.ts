/** Wording for ship and delivery estimates (dates come from @printing/pricing schedule). */
import { addCalendarDays, localDateTime } from '@printing/pricing';

/** 'YYYY-MM-DD' shop date as "Fri, Oct 23". */
export function formatShopDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Wed, Oct 28 – Fri, Oct 30", or one date when both are the same. */
export function formatDateRange(from: string, to: string): string {
  return from === to ? formatShopDate(from) : `${formatShopDate(from)} – ${formatShopDate(to)}`;
}

const ZONE_LABELS: Record<string, string> = { 'America/Los_Angeles': 'PT' };

/** The cutoff as customers read it: "2:00 PM PT today", "2:00 PM PT tomorrow", "2:00 PM PT Mon, Oct 26". */
export function orderByText(orderByIso: string, timeZone: string, now: Date): string {
  const instant = new Date(orderByIso);
  const time = instant.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const zone = ZONE_LABELS[timeZone] ?? '';
  const day = localDateTime(instant, timeZone).date;
  const today = localDateTime(now, timeZone).date;
  const when = day === today ? 'today' : day === addCalendarDays(today, 1) ? 'tomorrow' : formatShopDate(day);
  return `${time}${zone ? ` ${zone}` : ''} ${when}`;
}
