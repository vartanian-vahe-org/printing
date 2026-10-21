/**
 * Ports for the services whose provider is not chosen yet (docs/decisions.md T14).
 * Checkout and orders only talk to these interfaces; the defaults live in ./providers.
 * Adding Stripe / EasyPost / a tax service = a new provider class + a change in commerce.module.ts.
 */
import type { PricedShippingOption } from '@printing/pricing';

export interface ShippingAddress {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
}

// ---------------------------------------------------------------- payment

export interface PaymentRequest {
  orderId: string;
  orderNumber: number;
  amountCents: number;
  email: string;
}

export type PaymentNextStep =
  /** Nothing to do online; the shop collects payment and marks the order paid. */
  | { type: 'manual'; message: string }
  /** Send the customer to a hosted payment page (e.g. Stripe Checkout). */
  | { type: 'redirect'; url: string };

export interface PaymentStart {
  status: 'pending' | 'succeeded';
  /** Provider reference stored on the payment row. */
  reference: string | null;
  next: PaymentNextStep;
}

export interface PaymentProvider {
  readonly code: string;
  /** Shown on the checkout page next to "Place order", e.g. how and when the customer pays. */
  readonly checkoutNote: string;
  start(request: PaymentRequest): Promise<PaymentStart>;
  /** What an unpaid customer should do next (order page), or null when nothing is needed. */
  instructions(request: PaymentRequest): string | null;
}

// ---------------------------------------------------------------- shipping

export interface ShippingRateRequest {
  address: Pick<ShippingAddress, 'state' | 'zip'>;
  subtotalCents: number;
}

export interface ShippingRateProvider {
  readonly code: string;
  rates(request: ShippingRateRequest): Promise<PricedShippingOption[]>;
}

// ---------------------------------------------------------------- tax

export interface TaxRequest {
  /** City is known when the order is placed; checkout estimates send only state and ZIP. */
  address: Pick<ShippingAddress, 'state' | 'zip'> & { city?: string };
  subtotalCents: number;
  shippingCents: number;
}

export interface TaxResult {
  provider: string;
  taxCents: number;
  /** Rate applied, for the order snapshot and receipts. */
  rateBps: number;
  label: string;
}

export interface TaxProvider {
  readonly code: string;
  calculate(request: TaxRequest): Promise<TaxResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const SHIPPING_RATE_PROVIDER = Symbol('SHIPPING_RATE_PROVIDER');
export const TAX_PROVIDER = Symbol('TAX_PROVIDER');
