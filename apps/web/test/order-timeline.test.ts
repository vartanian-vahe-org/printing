import { describe, expect, it } from 'vitest';
import { orderTimeline } from '../lib/order-timeline.js';

const placed = {
  status: 'placed',
  paymentStatus: 'unpaid',
  proofStatus: 'pending' as const,
  placedAt: '2026-10-21T10:00:00.000Z',
  paidAt: null,
  shippedAt: null,
};

const states = (order: Parameters<typeof orderTimeline>[0]) => orderTimeline(order).map((s) => `${s.key}:${s.state}`);

describe('orderTimeline', () => {
  it('starts with payment as the current step', () => {
    expect(states(placed)).toEqual(['placed:done', 'paid:current', 'proof:upcoming', 'printing:upcoming', 'shipped:upcoming']);
    expect(orderTimeline(placed)[1]!.note).toMatch(/Waiting for payment/);
  });

  it('asks for the proof once paid and a proof is waiting', () => {
    const steps = orderTimeline({ ...placed, paymentStatus: 'paid', paidAt: '2026-10-21T12:00:00.000Z', proofStatus: 'awaiting_customer' });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(steps[1]!.date).toBe('2026-10-21T12:00:00.000Z');
    expect(steps[2]!.note).toMatch(/approve/);
  });

  it('shows printing while in production', () => {
    const steps = orderTimeline({ ...placed, status: 'in_production', paymentStatus: 'paid', proofStatus: 'approved' });
    expect(steps[3]).toMatchObject({ key: 'printing', state: 'current', note: expect.stringMatching(/printed/) });
  });

  it('marks everything done once shipped', () => {
    const steps = orderTimeline({ ...placed, status: 'shipped', paymentStatus: 'paid', proofStatus: 'approved', shippedAt: '2026-10-24T18:00:00.000Z' });
    expect(steps.every((s) => s.state === 'done' && s.note === null)).toBe(true);
    expect(steps[4]!.date).toBe('2026-10-24T18:00:00.000Z');
  });

  it('asks for a new file when the check found errors', () => {
    const steps = orderTimeline({ ...placed, paymentStatus: 'paid', proofStatus: 'needs_new_file' });
    expect(steps[2]).toMatchObject({ key: 'proof', state: 'current', note: expect.stringMatching(/new file/) });
  });
});
