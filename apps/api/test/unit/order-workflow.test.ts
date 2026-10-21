import { describe, expect, it } from 'vitest';
import { allowedActions, refusal } from '../../src/orders/order-workflow.js';

describe('order workflow', () => {
  it('a new order waits for payment and can be cancelled', () => {
    expect(allowedActions({ status: 'placed', paymentStatus: 'unpaid', proofStatus: 'awaiting_customer' })).toEqual(['record_payment', 'cancel']);
  });

  it('a paid order waits for its proofs before production', () => {
    expect(allowedActions({ status: 'placed', paymentStatus: 'paid', proofStatus: 'awaiting_customer' })).toEqual(['cancel']);
    expect(allowedActions({ status: 'placed', paymentStatus: 'paid', proofStatus: 'needs_new_file' })).toEqual(['cancel']);
  });

  it('a paid order with approved proofs can go into production', () => {
    expect(allowedActions({ status: 'placed', paymentStatus: 'paid', proofStatus: 'approved' })).toEqual(['start_production', 'cancel']);
  });

  it('tracking is added during production and again after shipping', () => {
    expect(allowedActions({ status: 'in_production', paymentStatus: 'paid', proofStatus: 'approved' })).toEqual(['add_shipment', 'cancel']);
    expect(allowedActions({ status: 'shipped', paymentStatus: 'paid', proofStatus: 'approved' })).toEqual(['add_shipment', 'mark_delivered']);
  });

  it('nothing happens to delivered orders', () => {
    expect(allowedActions({ status: 'completed', paymentStatus: 'paid', proofStatus: 'approved' })).toEqual([]);
  });

  it('a cancelled paid order needs a refund; an unpaid one is closed', () => {
    expect(allowedActions({ status: 'cancelled', paymentStatus: 'paid', proofStatus: 'approved' })).toEqual(['record_refund']);
    expect(allowedActions({ status: 'cancelled', paymentStatus: 'unpaid', proofStatus: 'approved' })).toEqual([]);
    expect(allowedActions({ status: 'cancelled', paymentStatus: 'refunded', proofStatus: 'approved' })).toEqual([]);
  });

  it('explains refused actions', () => {
    expect(refusal({ status: 'shipped', paymentStatus: 'paid', proofStatus: 'approved' }, 'cancel')).toMatch(/cannot be cancelled/);
    expect(refusal({ status: 'placed', paymentStatus: 'unpaid', proofStatus: 'awaiting_customer' }, 'start_production')).toMatch(/paid/);
    expect(refusal({ status: 'placed', paymentStatus: 'unpaid', proofStatus: 'awaiting_customer' }, 'record_payment')).toBeNull();
  });
});
