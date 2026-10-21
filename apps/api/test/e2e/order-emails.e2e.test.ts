/**
 * Order emails and "find my order" against a running stack: emails are read back from Mailpit.
 * Each test uses its own email address so runs do not see each other's messages.
 */
import { describe, expect, it } from 'vitest';
import { base, mailpit, messageBody, messagesTo, placeOrder, uniqueEmail, waitFor, waitForMessages, type MailSummary } from './helpers.js';

/**
 * A client IP of our own for this run, so the per-IP lookup limit starts fresh. Works because the API
 * trusts one proxy hop (X-Forwarded-For) and nothing sits in front of it locally.
 */
const clientIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const lookup = (number: number, email: string) =>
  fetch(`${base}/orders/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({ number, email }),
  });

describe('order emails', () => {
  it('emails the customer a confirmation with a working order link, and notifies the shop', async () => {
    const email = uniqueEmail();
    const order = await placeOrder(email);

    const [confirmation] = await waitForMessages(email, 1);
    expect(confirmation?.Subject).toBe(`Order #${order.number} received – Print Studio`);
    const body = await messageBody(confirmation!.ID);
    const link = body.Text.match(/View your order: (\S+)/)?.[1];
    expect(link).toMatch(new RegExp(`/orders/${order.number}#`));
    const token = link!.split('#')[1]!;
    expect(token).toBe(order.accessToken);
    const view = await fetch(`${base}/orders/${order.number}`, { headers: { 'x-order-token': token } });
    expect(view.status).toBe(200);

    // The staff notification goes to the store_settings addresses.
    const staff = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"New order #${order.number}"`)}`);
    const staffMessages = ((await staff.json()) as { messages: MailSummary[] }).messages;
    expect(staffMessages).toHaveLength(1);
    expect(staffMessages[0]!.To.map((t) => t.Address)).toEqual(['orders@printing.local']);
  });
});

describe('POST /orders/lookup', () => {
  it('emails the same order link when number and email match, and nothing otherwise', async () => {
    const email = uniqueEmail();
    const order = await placeOrder(email);
    await waitForMessages(email, 1);

    const wrong = await lookup(order.number, 'someone-else@example.com');
    const right = await lookup(order.number, email.toUpperCase());
    expect(wrong.status).toBe(202);
    expect(right.status).toBe(202);
    expect(await wrong.json()).toEqual(await right.json());

    // The link email (other emails, like the proof, may arrive in between).
    const linkEmail = await waitFor(async () => (await messagesTo(email)).find((m) => m.Subject.startsWith('Your link to order')));
    expect((await messageBody(linkEmail!.ID)).Text).toContain(`#${order.accessToken}`);
    expect(await messagesTo('someone-else@example.com').then((m) => m.filter((x) => x.Subject.includes(String(order.number))))).toEqual([]);
  });

  it('limits lookups per order', async () => {
    const number = 900_000_000 + Math.floor(Math.random() * 99_000_000);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await lookup(number, 'x@example.com')).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
