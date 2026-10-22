/** Order progress steps for the customer's order page. */
import type { OrderView } from './checkout';

export interface TimelineStep {
  key: 'placed' | 'paid' | 'proof' | 'printing' | 'shipped';
  label: string;
  state: 'done' | 'current' | 'upcoming';
  /** ISO date when the step was completed, if known. */
  date: string | null;
  /** Short explanation for the current step. */
  note: string | null;
}

type Draft = Omit<TimelineStep, 'state'> & { done: boolean };

type Order = Pick<OrderView, 'status' | 'paymentStatus' | 'proofStatus' | 'placedAt' | 'paidAt' | 'shippedAt'>;

export function orderTimeline(order: Order): TimelineStep[] {
  const printed = order.status === 'shipped' || order.status === 'completed';
  const steps: Draft[] = [
    { key: 'placed', label: 'Order placed', done: true, date: order.placedAt, note: null },
    {
      key: 'paid',
      label: 'Payment received',
      done: order.paymentStatus === 'paid' || order.paymentStatus === 'refunded',
      date: order.paidAt,
      note: 'Waiting for payment. Our team will contact you.',
    },
    {
      key: 'proof',
      label: 'Proof approved',
      done: order.proofStatus === 'approved',
      date: null,
      note:
        order.proofStatus === 'awaiting_customer'
          ? 'Your proof is ready. Please review and approve it below.'
          : order.proofStatus === 'needs_new_file'
            ? 'We need a new file from you. See below.'
            : order.proofStatus === 'awaiting_design'
              ? 'Our designer is working on your design. We will email you the proof.'
              : 'We are checking your design.',
    },
    {
      key: 'printing',
      label: 'Printing',
      done: printed,
      date: null,
      note: order.status === 'in_production' ? 'Your cards are being printed in our California shop.' : null,
    },
    { key: 'shipped', label: 'Shipped', done: printed, date: order.shippedAt, note: null },
  ];

  let currentFound = false;
  return steps.map(({ done, ...step }): TimelineStep => {
    if (done) return { ...step, state: 'done', note: null };
    const state = currentFound ? 'upcoming' : 'current';
    currentFound = true;
    return { ...step, state, note: state === 'current' ? step.note : null, date: null };
  });
}
