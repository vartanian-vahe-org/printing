/**
 * Order totals shared by the storefront (cart/checkout display) and the API (official totals).
 * Money is integer cents everywhere.
 */

export interface ShippingOption {
  code: string;
  label: string;
  /** Price before any free-shipping threshold is applied. */
  basePriceCents: number;
  /** Order subtotal at or above which this option is free; null = never free. */
  freeOverCents: number | null;
  transitDaysMin: number;
  transitDaysMax: number;
}

export interface PricedShippingOption extends ShippingOption {
  priceCents: number;
  isFree: boolean;
}

export function priceShippingOption(option: ShippingOption, subtotalCents: number): PricedShippingOption {
  const isFree = option.freeOverCents !== null && subtotalCents >= option.freeOverCents;
  return { ...option, priceCents: isFree ? 0 : option.basePriceCents, isFree };
}

/** Tax on an amount at a rate in basis points (725 = 7.25%), rounded half up to the cent. */
export function taxForAmount(amountCents: number, rateBps: number): number {
  if (amountCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((amountCents * rateBps + 5000) / 10000);
}

export interface OrderTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export function orderTotals(subtotalCents: number, shippingCents: number, taxCents: number): OrderTotals {
  return { subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents };
}

/** Two-letter US state codes accepted for shipping (50 states + DC). */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

export type UsState = (typeof US_STATES)[number];

export function isUsState(value: string): value is UsState {
  return (US_STATES as readonly string[]).includes(value);
}

/** 5-digit ZIP or ZIP+4. */
export function isUsZip(value: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(value.trim());
}

/** US phone: 10 digits once formatting and a leading country code 1 are removed. */
export function isUsPhone(value: string): boolean {
  return /^1?\d{10}$/.test(value.replace(/\D/g, ''));
}
