/**
 * What staff can do with an order in each state. The API refuses anything not listed here and
 * the admin shows only these buttons.
 *
 *   placed ──(payment + every proof approved)──> in_production ──(tracking)──> shipped ──> completed
 *      └──────────── cancel (before shipping) ────────────┘        cancelled+paid ──> refunded
 */
export const ORDER_ACTIONS = [
  'record_payment',
  'start_production',
  'add_shipment',
  'mark_delivered',
  'cancel',
  'record_refund',
] as const;

export type OrderAction = (typeof ORDER_ACTIONS)[number];

export interface WorkflowState {
  status: string;
  paymentStatus: string;
  /** Proof state of the whole order (approved only when every item is). */
  proofStatus: string;
}

export function allowedActions(order: WorkflowState): OrderAction[] {
  const { status, paymentStatus, proofStatus } = order;
  const actions: OrderAction[] = [];
  if (paymentStatus === 'unpaid' && status !== 'cancelled') actions.push('record_payment');
  // Spec §6.4: production only once paid and every proof is approved.
  if (status === 'placed' && paymentStatus === 'paid' && proofStatus === 'approved') actions.push('start_production');
  if (status === 'in_production' || status === 'shipped') actions.push('add_shipment');
  if (status === 'shipped') actions.push('mark_delivered');
  if (status === 'placed' || status === 'in_production') actions.push('cancel');
  if (status === 'cancelled' && paymentStatus === 'paid') actions.push('record_refund');
  return actions;
}

const ACTION_REFUSALS: Record<OrderAction, string> = {
  record_payment: 'Payment can only be recorded on an unpaid order that is not cancelled.',
  start_production: 'Only paid orders with every proof approved can go into production.',
  add_shipment: 'Tracking can be added once the order is in production.',
  mark_delivered: 'Only shipped orders can be marked delivered.',
  cancel: 'Orders that have shipped cannot be cancelled.',
  record_refund: 'Refunds are recorded on cancelled orders that were paid.',
};

/** Error text when `action` is not allowed, or null when it is. */
export function refusal(order: WorkflowState, action: OrderAction): string | null {
  return allowedActions(order).includes(action) ? null : ACTION_REFUSALS[action];
}

/** Admin list filters ("tabs"). */
export const ORDER_VIEWS = ['needs_payment', 'proof', 'ready', 'printing', 'shipped', 'cancelled', 'all'] as const;
export type OrderListView = (typeof ORDER_VIEWS)[number];
