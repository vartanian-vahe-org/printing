/**
 * Spam guards (open issues X5, X1): order placement per IP and per email, upload links per IP.
 * Requests without a cart are refused (400) but still counted, then the limit answers 429.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { address, base, uniqueEmail } from './helpers.js';

const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const placeWithoutCart = (ip: string, email: string) =>
  fetch(`${base}/checkout/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: 0 }),
  }).then((r) => r.status);

describe('rate limits', () => {
  it('allows 20 order attempts per IP an hour', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push(await placeWithoutCart(ip, uniqueEmail()));
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('allows 10 order attempts per email an hour, from any IP', async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push(await placeWithoutCart(randomIp(), email));
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('allows 60 upload links per IP an hour', async () => {
    const ip = randomIp();
    const presign = () =>
      fetch(`${base}/uploads/presign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ kind: 'artwork', filename: `${randomUUID()}.pdf`, contentType: 'application/pdf', sizeBytes: 1000 }),
      }).then((r) => r.status);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push(await presign());
    expect(statuses.filter((s) => s === 201 || s === 200)).toHaveLength(60);
    expect(statuses[60]).toBe(429);
  });
});
