/** Shared helpers for e2e tests against a running stack (API + Mailpit). */
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

export const base = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const mailpit = process.env.MAILPIT_URL ?? `http://localhost:${process.env.MAILPIT_UI_PORT ?? 8025}`;

export const selection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: '3d',
};

export const address = { name: 'Jamie Rivera', line1: '100 Main St', city: 'Los Angeles', state: 'CA', zip: '90012', phone: '(213) 555-0100' };

/**
 * A client IP of this test file's own (the API trusts one proxy hop, nothing sits in front of it
 * locally), so per-IP rate limits never carry over between runs or files.
 */
export const testIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
export const testHeaders = { 'x-forwarded-for': testIp };

export const uniqueEmail = () => `e2e-${randomUUID().slice(0, 8)}@example.com`;

/** Adds one template item to a fresh guest cart and checks out with standard shipping. */
export async function placeOrder(email: string): Promise<{ number: number; accessToken: string }> {
  let cookie = '';
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...testHeaders, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return (await res.json()) as Record<string, any>;
  };
  await call('/cart/items', {
    productCode: 'business-cards',
    configuration: { selection, quantity: 500 },
    design: { mode: 'template', templateCode: 'classic', values: { name: 'Jamie Rivera' } },
  });
  const quote = await call('/checkout/quote', { address: { state: 'CA', zip: '90012' } });
  const order = await call('/checkout/orders', {
    email,
    shippingAddress: address,
    shippingMethodCode: 'standard',
    expectedTotalCents: quote.totals.totalCents,
  });
  expect(order.number).toBeGreaterThan(0);
  return order as { number: number; accessToken: string };
}

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function searchMail(query: string): Promise<MailSummary[]> {
  const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}

export const messagesTo = (email: string) => searchMail(`to:"${email}"`);

/** Waits for the queue worker to deliver `count` messages to `email`. */
export async function waitForMessages(email: string, count: number, timeoutMs = 10_000): Promise<MailSummary[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await messagesTo(email);
    if (messages.length >= count || Date.now() > deadline) return messages;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function messageBody(id: string): Promise<{ HTML: string; Text: string }> {
  return (await fetch(`${mailpit}/api/v1/message/${id}`)).json() as Promise<{ HTML: string; Text: string }>;
}

/** Polls `check` until it returns a value (not undefined/false) or the time runs out. */
export async function waitFor<T>(check: () => Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Customer view of an order through its private link. */
export async function customerOrder(number: number, token: string): Promise<Record<string, any>> {
  return (await fetch(`${base}/orders/${number}`, { headers: { 'x-order-token': token } })).json() as Promise<Record<string, any>>;
}

/** Waits for the prepress worker to finish every item's file check. */
export function waitForProofs(number: number, token: string) {
  return waitFor(async () => {
    const order = await customerOrder(number, token);
    return order.items.every((i: any) => i.proof.status !== 'pending') ? order : undefined;
  });
}
