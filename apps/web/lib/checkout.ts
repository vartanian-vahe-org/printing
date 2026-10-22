/** Browser client for checkout and the customer's order page. */
import type { OrderTotals, PricedShippingOption } from '@printing/pricing';
import { CART_CHANGED_EVENT, type Cart } from './cart';

export interface ShippingAddress {
  name: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export interface CheckoutQuote {
  cart: Cart;
  /** Each option with its estimated delivery window if the order is placed now. */
  shippingOptions: (PricedShippingOption & { deliveryFrom: string | null; deliveryTo: string | null })[];
  shippingMethodCode: string | null;
  tax: { label: string; rateBps: number; taxCents: number } | null;
  totals: OrderTotals;
  payment: { provider: string; note: string };
  ready: boolean;
}

export interface PlacedOrder {
  number: number;
  accessToken: string;
  totalCents: number;
  next: { type: 'manual'; message: string } | { type: 'redirect'; url: string };
}

export type ProofStatus = 'pending' | 'awaiting_design' | 'awaiting_customer' | 'needs_new_file' | 'approved';

export interface ProofIssue {
  id: string;
  code: string;
  level: 'error' | 'warning';
  message: string;
  page?: number;
}

export interface ItemProof {
  status: ProofStatus;
  issues: ProofIssue[];
  images: { page: number; url: string }[];
  approvedAt: string | null;
  checkFailed: boolean;
}

export interface OrderView {
  number: number;
  status: string;
  paymentStatus: string;
  proofStatus: ProofStatus;
  email: string;
  placedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  cancelledAt: string | null;
  shipBy: string | null;
  deliverFrom: string | null;
  deliverTo: string | null;
  shippingAddress: ShippingAddress;
  shippingMethod: { label: string; priceCents: number; transitDaysMin: number; transitDaysMax: number };
  tax: { label: string; rateBps: number };
  items: {
    number: number;
    productName: string;
    summary: { label: string; value: string }[];
    design:
      | { mode: 'template'; templateCode: string; values: Record<string, string> }
      | { mode: 'upload'; front: { fileName: string }; back?: { fileName: string } }
      | {
          mode: 'service';
          tierCode: string;
          brief: { content: string; notes: string; files: { fileName: string }[] };
          artwork?: { round: number };
          changeRequests?: { message: string; at: string; round: number }[];
        };
    quantity: number;
    totalCents: number;
    proof: ItemProof;
    /** "Let us design it" package bought with the item, or null. */
    designService: { name: string; designDays: number; revisions: number | null } | null;
  }[];
  shipments: { carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; shippedAt: string }[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  paymentInstructions: string | null;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    /** Machine-readable reason from the API: 'total_changed', 'cart_invalid', 'shipping_unavailable'. */
    public readonly code: string | null = null,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new CheckoutError('Checkout is not configured');
  const { json, headers, ...rest } = init;
  const res = await fetch(`${url}${path}`, {
    ...rest,
    credentials: 'include',
    headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & { message?: unknown; code?: string; issues?: string[] }) | null;
  if (!res.ok || !body) {
    const message = typeof body?.message === 'string' ? body.message : 'Something went wrong. Please try again.';
    throw new CheckoutError(message, body?.code ?? null, body?.issues ?? []);
  }
  return body;
}

export function getCheckoutQuote(input: { address?: { state: string; zip: string }; shippingMethodCode?: string }) {
  return call<CheckoutQuote>('/checkout/quote', { method: 'POST', json: input });
}

export async function placeOrder(input: {
  email: string;
  shippingAddress: ShippingAddress;
  shippingMethodCode: string;
  expectedTotalCents: number;
}): Promise<PlacedOrder> {
  const order = await call<PlacedOrder>('/checkout/orders', { method: 'POST', json: input });
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: 0 }));
  return order;
}

/** The token comes from the order link's #fragment and is sent as a header, never in the URL. */
export function getOrder(number: number, token: string) {
  return call<OrderView>(`/orders/${number}`, { headers: { 'x-order-token': token } });
}

export function approveProof(number: number, item: number, token: string, acknowledged: string[]) {
  return call<void>(`/orders/${number}/items/${item}/proof/approve`, { method: 'POST', json: { acknowledged }, headers: { 'x-order-token': token } });
}

/** "Let us design it" items: ask our designer for changes instead of approving. */
export function requestDesignChanges(number: number, item: number, token: string, message: string) {
  return call<{ message: string }>(`/orders/${number}/items/${item}/proof/changes`, { method: 'POST', json: { message }, headers: { 'x-order-token': token } });
}

export interface ReplacementFile {
  key: string;
  fileName: string;
  pageCount: number;
}

export function replaceItemFile(number: number, item: number, token: string, files: { front: ReplacementFile; back?: ReplacementFile }) {
  return call<{ message: string }>(`/orders/${number}/items/${item}/file`, { method: 'POST', json: files, headers: { 'x-order-token': token } });
}

/** "Find my order": the API emails the order link when number and email match (same reply either way). */
export function requestOrderLink(number: number, email: string) {
  return call<{ message: string }>('/orders/lookup', { method: 'POST', json: { number, email } });
}

/** Link to the order page; the secret goes in the fragment so it is not sent to any server. */
export function orderPath(number: number, token: string): string {
  return `/orders/${number}#${token}`;
}
