const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** "+$1.75", "−$2.50" (true minus sign), or "" for zero. */
export function formatDelta(cents: number): string {
  if (cents === 0) return '';
  return `${cents > 0 ? '+' : '−'}${usd.format(Math.abs(cents) / 100)}`;
}

/** 2.5 -> 2.5", 3 -> 3" */
export function formatInches(value: number): string {
  return `${Number(value.toFixed(3))}"`;
}

/** "1 business day", "2 business days", "3–5 business days" */
export function formatBusinessDays(min: number, max: number): string {
  if (min === max) return `${min} business day${min === 1 ? '' : 's'}`;
  return `${min}–${max} business days`;
}
