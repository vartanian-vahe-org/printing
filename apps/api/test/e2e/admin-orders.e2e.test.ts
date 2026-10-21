/**
 * Order processing in the admin, end to end: payment, production, shipping, cancel, refund,
 * with the customer emails read back from Mailpit. Needs ADMIN_EMAIL / ADMIN_PASSWORD (see admin.e2e).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { base, messageBody, placeOrder, uniqueEmail, waitForMessages, waitForProofs } from './helpers.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

let cookie = '';

async function admin(method: string, path: string, body?: unknown, withCookie = true) {
  const res = await fetch(`${base}/admin/orders${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(withCookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
}

beforeAll(async () => {
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

describe('admin orders', () => {
  it('requires a session', async () => {
    expect((await admin('GET', '', undefined, false)).status).toBe(401);
    expect((await admin('POST', '/100001/production', {}, false)).status).toBe(401);
  });

  it('lists and finds a new order under "needs payment"', async () => {
    const customer = uniqueEmail();
    const order = await placeOrder(customer);
    const list = await admin('GET', `?view=needs_payment&q=${encodeURIComponent(customer)}`);
    expect(list.status).toBe(200);
    expect(list.body.orders).toEqual([expect.objectContaining({ number: order.number, email: customer, status: 'placed', paymentStatus: 'unpaid' })]);
    expect(list.body.counts.needs_payment).toBe(1);
    expect((await admin('GET', `?q=%23${order.number}`)).body.orders[0].number).toBe(order.number);
    expect((await admin('GET', '?view=nope')).status).toBe(400);
  });

  it('takes an order from payment to delivered, emailing the customer', async () => {
    const customer = uniqueEmail();
    const order = await placeOrder(customer);
    const path = `/${order.number}`;

    const detail = await admin('GET', path);
    expect(detail.body.allowedActions).toEqual(['record_payment', 'cancel']);
    expect(detail.body.events.map((e: any) => e.type)).toContain('placed');
    expect(detail.body.customerUrl).toContain(`/orders/${order.number}#${order.accessToken}`);

    expect((await admin('POST', `${path}/shipments`, { carrier: 'ups', trackingNumber: '1Z1' })).status).toBe(409);
    expect((await admin('POST', `${path}/production`)).status).toBe(409);

    expect((await admin('POST', `${path}/payments`, { reference: 'Zelle 10/21' })).status).toBe(204);
    // Paying moves the estimates to "production starts now"; they are set either way.
    const paid = await admin('GET', path);
    expect(paid.body.shipBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(paid.body.events.find((e: any) => e.type === 'record_payment').message).toMatch(/ships by \d{4}-/);
    expect((await admin('POST', `${path}/payments`, { reference: 'again' })).status).toBe(409);
    // Paid, but the proof is not approved yet: no production (spec §6.4).
    await waitForProofs(order.number, order.accessToken);
    expect((await admin('POST', `${path}/production`)).status).toBe(409);
    expect((await admin('POST', `${path}/items/1/proof/approve`)).status).toBe(204);
    expect((await admin('POST', `${path}/production`)).status).toBe(204);
    expect(
      (await admin('POST', `${path}/shipments`, { carrier: 'UPS', service: 'Ground', trackingNumber: '1Z999AA10123456784' })).status,
    ).toBe(204);

    // Customer emails: confirmation, proof ready, payment received, shipped (with the tracking link).
    const messages = await waitForMessages(customer, 4);
    const subjects = messages.map((m) => m.Subject);
    expect(subjects).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Payment received/), expect.stringMatching(/has shipped/)]),
    );
    const shipped = await messageBody(messages.find((m) => m.Subject.includes('has shipped'))!.ID);
    expect(shipped.Text).toContain('https://www.ups.com/track?tracknum=1Z999AA10123456784');

    // The customer's order page shows the shipment.
    const view = await fetch(`${base}/orders/${order.number}`, { headers: { 'x-order-token': order.accessToken } }).then((r) => r.json());
    expect(view).toMatchObject({ status: 'shipped', paymentStatus: 'paid', shipments: [{ carrier: 'ups', trackingNumber: '1Z999AA10123456784' }] });

    expect((await admin('POST', `${path}/cancel`, {})).status).toBe(409);
    expect((await admin('POST', `${path}/delivered`)).status).toBe(204);

    const done = await admin('GET', path);
    expect(done.body).toMatchObject({ status: 'completed', allowedActions: [] });
    expect(done.body.payments).toEqual([expect.objectContaining({ status: 'succeeded', reference: 'Zelle 10/21', recordedBy: expect.any(String) })]);
    expect(done.body.events.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(['placed', 'record_payment', 'start_production', 'add_shipment', 'mark_delivered']),
    );
  });

  it('cancels an unpaid order with a reason, and refunds a paid one', async () => {
    const customer = uniqueEmail();
    const unpaid = await placeOrder(customer);
    expect((await admin('POST', `/${unpaid.number}/cancel`, { reason: 'Duplicate order' })).status).toBe(204);
    const cancelled = await admin('GET', `/${unpaid.number}`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', paymentStatus: 'unpaid', allowedActions: [] });
    expect(cancelled.body.payments[0].status).toBe('cancelled');

    const messages = await waitForMessages(customer, 2);
    const cancelEmail = messages.find((m) => m.Subject.includes('was cancelled'));
    expect((await messageBody(cancelEmail!.ID)).Text).toContain('Duplicate order');

    const paid = await placeOrder(uniqueEmail());
    await admin('POST', `/${paid.number}/payments`, { reference: 'Check #12', notify: false });
    await admin('POST', `/${paid.number}/cancel`, { notify: false });
    expect((await admin('GET', `/${paid.number}`)).body.allowedActions).toEqual(['record_refund']);
    expect((await admin('POST', `/${paid.number}/refunds`, { reference: 'Refund check #13' })).status).toBe(204);
    expect((await admin('GET', `/${paid.number}`)).body).toMatchObject({ paymentStatus: 'refunded', allowedActions: [] });
  });

  it('adds notes and resends only emails that fit the order', async () => {
    const order = await placeOrder(uniqueEmail());
    expect((await admin('POST', `/${order.number}/notes`, { text: 'Customer called about matte finish' })).status).toBe(204);
    expect((await admin('POST', `/${order.number}/emails`, { kind: 'order-shipped' })).status).toBe(400);
    expect((await admin('POST', `/${order.number}/emails`, { kind: 'order-confirmation' })).status).toBe(204);
    expect((await admin('POST', `/${order.number}/emails`, { kind: 'order-link' })).status).toBe(400);
    const events = (await admin('GET', `/${order.number}`)).body.events;
    expect(events.find((e: any) => e.type === 'note')).toMatchObject({ message: 'Note: Customer called about matte finish' });
  });

  it('validates input', async () => {
    const order = await placeOrder(uniqueEmail());
    expect((await admin('POST', `/${order.number}/payments`, { reference: '' })).status).toBe(400);
    expect((await admin('POST', `/${order.number}/shipments`, { carrier: 'ups' })).status).toBe(400);
    expect((await admin('GET', '/99999999')).status).toBe(404);
  });
});
