/** Admin order types (GET /admin/orders…) and display helpers. */

export type OrderListView = 'needs_payment' | 'proof' | 'ready' | 'printing' | 'shipped' | 'cancelled' | 'all';
export type OrderAction = 'record_payment' | 'start_production' | 'add_shipment' | 'mark_delivered' | 'cancel' | 'record_refund';
export type ResendableEmail = 'order-confirmation' | 'proof-ready' | 'payment-received' | 'order-shipped' | 'order-cancelled';

export interface OrderListItem {
  number: number;
  placedAt: string;
  email: string;
  name: string;
  state: string;
  itemCount: number;
  totalCents: number;
  status: string;
  paymentStatus: string;
  shipBy: string | null;
}

export interface OrderList {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<OrderListView, number>;
}

export interface OrderDetail {
  number: number;
  status: string;
  paymentStatus: string;
  proofStatus: string;
  email: string;
  placedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  cancelledAt: string | null;
  shipBy: string | null;
  deliverFrom: string | null;
  deliverTo: string | null;
  shippingAddress: { name: string; company?: string; line1: string; line2?: string; city: string; state: string; zip: string; phone: string };
  shippingMethod: { label: string; priceCents: number; transitDaysMin: number; transitDaysMax: number };
  tax: { label: string; rateBps: number };
  items: {
    number: number;
    proof: {
      status: ProofStatus;
      issues: { id: string; code: string; level: 'error' | 'warning'; message: string; page?: number }[];
      images: { page: number; url: string }[];
      approvedAt: string | null;
      checkFailed: boolean;
    };
    productName: string;
    summary: { label: string; value: string }[];
    design:
      | { mode: 'template'; templateCode: string; values: Record<string, string> }
      | { mode: 'upload'; front: { fileName: string; pageCount: number }; back?: { fileName: string } }
      | ServiceDesign;
    /** "Let us design it" package bought with the item, or null. */
    designService: { name: string; designDays: number; revisions: number | null } | null;
    quantity: number;
    totalCents: number;
    templateName: string | null;
    files: { label: string; fileName: string; url: string }[];
  }[];
  shipments: { carrier: string; service: string | null; trackingNumber: string; trackingUrl: string | null; shippedAt: string }[];
  payments: { provider: string; status: string; amountCents: number; reference: string | null; recordedBy: string | null; createdAt: string }[];
  events: { type: string; message: string; by: string; createdAt: string }[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  allowedActions: OrderAction[];
  customerUrl: string;
}

/** "Let us design it": the customer's brief, the designer's deliveries and the change requests. */
export interface ServiceDesign {
  mode: 'service';
  tierCode: string;
  brief: { content: string; notes: string; files: { fileName: string }[] };
  artwork?: { front: { fileName: string }; back?: { fileName: string }; round: number; deliveredAt: string };
  changeRequests?: { message: string; at: string; round: number }[];
}

export type ProofStatus = 'pending' | 'awaiting_design' | 'awaiting_customer' | 'needs_new_file' | 'approved';

export const PROOF_LABELS: Record<ProofStatus, string> = {
  pending: 'Checking file',
  awaiting_design: 'Designer to do',
  awaiting_customer: 'Waiting for customer',
  needs_new_file: 'New file needed',
  approved: 'Approved',
};

export const ORDER_VIEW_TABS: { view: OrderListView; label: string }[] = [
  { view: 'needs_payment', label: 'Needs payment' },
  { view: 'proof', label: 'Waiting for proof' },
  { view: 'ready', label: 'Ready to print' },
  { view: 'printing', label: 'Printing' },
  { view: 'shipped', label: 'Shipped' },
  { view: 'cancelled', label: 'Cancelled' },
  { view: 'all', label: 'All' },
];

export const STATUS_LABELS: Record<string, string> = {
  placed: 'New',
  in_production: 'Printing',
  shipped: 'Shipped',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  refunded: 'Refunded',
};

export const EMAIL_LABELS: Record<ResendableEmail, string> = {
  'order-confirmation': 'Order confirmation',
  'proof-ready': 'Proof ready',
  'payment-received': 'Payment received',
  'order-shipped': 'Shipped (tracking)',
  'order-cancelled': 'Cancellation',
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number) => usd.format(cents / 100);

/** Dates in the shop's time zone (California), e.g. "Oct 21, 2:05 PM". */
export function shopDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: SHOP_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "2 days", "3–5 days" */
export function transitDays(min: number, max: number): string {
  return min === max ? `${min} day${min === 1 ? '' : 's'}` : `${min}–${max} days`;
}

const SHOP_TIME_ZONE = 'America/Los_Angeles';

/** Today's date in the shop's time zone, 'YYYY-MM-DD'. */
export function shopToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: SHOP_TIME_ZONE });
}

/** 'YYYY-MM-DD' as "Fri, Oct 23". */
export function shopDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** How urgent an unshipped order is against its ship-by date. */
export function shipByState(order: { shipBy: string | null; status: string }, today = shopToday()): 'late' | 'today' | 'ok' | null {
  if (!order.shipBy || (order.status !== 'placed' && order.status !== 'in_production')) return null;
  if (order.shipBy < today) return 'late';
  return order.shipBy === today ? 'today' : 'ok';
}
