/**
 * Customer accounts (Phase 2 step 10) against a running stack, emails read from Mailpit:
 * registration, email verification attaching past orders, sign-in, password reset,
 * orders placed while signed in, "order again" and the cart following the customer.
 */
import { describe, expect, it } from 'vitest';
import { address, base, messageBody, placeOrder, searchMail, selection, uniqueEmail, waitFor } from './helpers.js';

/** One client IP per run, so the per-IP limits on sign-up and sign-in do not trip over earlier runs. */
const clientIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** A browser: keeps the customer and cart cookies. */
function browser() {
  const cookies = new Map<string, string>();
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-forwarded-for': clientIp,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair!.split('=') as [string, string];
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };
}

async function linkFromEmail(to: string, subject: string, path: string): Promise<string> {
  const mail = await waitFor(async () => (await searchMail(`to:"${to}" subject:"${subject}"`))[0]);
  const text = (await messageBody(mail.ID)).Text;
  return text.match(new RegExp(`${path}#([\\w-]+)`))![1]!;
}

describe('customer accounts', () => {
  it('past guest orders join the account only once the email is verified', async () => {
    const email = uniqueEmail();
    const guestOrder = await placeOrder(email);

    const me = browser();
    const registered = await me('POST', '/account/register', { email: email.toUpperCase(), name: 'Jamie Rivera', password: 'a-good-password' });
    expect(registered.status).toBe(201);
    expect(registered.body.customer).toMatchObject({ email, emailVerified: false });
    expect((await me('GET', '/account/orders')).body.orders).toEqual([]);
    expect((await browser()('POST', '/account/register', { email, name: 'Again', password: 'a-good-password' })).status).toBe(409);

    const token = await linkFromEmail(email, 'Confirm your email', '/account/verify');
    expect((await browser()('POST', '/account/verify', { token })).status).toBe(204);
    expect((await browser()('POST', '/account/verify', { token })).status).toBe(400);

    const orders = (await me('GET', '/account/orders')).body.orders;
    expect(orders.map((o: any) => o.number)).toEqual([guestOrder.number]);
    expect(orders[0].orderPath).toBe(`/orders/${guestOrder.number}#${guestOrder.accessToken}`);
    expect((await me('GET', '/account/me')).body.customer.emailVerified).toBe(true);
  });

  it('signs in and out; wrong passwords are refused', async () => {
    const email = uniqueEmail();
    await browser()('POST', '/account/register', { email, name: 'Jamie', password: 'a-good-password' });
    const me = browser();
    expect((await me('POST', '/account/sign-in', { email, password: 'wrong-password' })).status).toBe(401);
    expect((await me('POST', '/account/sign-in', { email, password: 'a-good-password' })).status).toBe(200);
    expect((await me('GET', '/account/me')).body.customer.email).toBe(email);
    expect((await me('POST', '/account/sign-out')).status).toBe(204);
    expect((await me('GET', '/account/me')).body.customer).toBeNull();
    expect((await me('GET', '/account/orders')).status).toBe(401);
  });

  it('resets a forgotten password by email, signing out old sessions', async () => {
    const email = uniqueEmail();
    const old = browser();
    await old('POST', '/account/register', { email, name: 'Jamie', password: 'first-password-1' });

    const unknown = await browser()('POST', '/account/password/forgot', { email: uniqueEmail() });
    const known = await browser()('POST', '/account/password/forgot', { email });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    const token = await linkFromEmail(email, 'Reset your password', '/account/reset');
    expect((await browser()('POST', '/account/password/reset', { token, password: 'second-password-2' })).status).toBe(204);
    expect((await browser()('POST', '/account/password/reset', { token, password: 'third-password-3' })).status).toBe(400);
    expect((await old('GET', '/account/me')).body.customer).toBeNull();

    const me = browser();
    expect((await me('POST', '/account/sign-in', { email, password: 'first-password-1' })).status).toBe(401);
    expect((await me('POST', '/account/sign-in', { email, password: 'second-password-2' })).status).toBe(200);
    // Reading the reset email proves the inbox: the email counts as verified.
    expect((await me('GET', '/account/me')).body.customer.emailVerified).toBe(true);
  });

  it('orders placed while signed in belong to the account, can be ordered again, and the cart follows the customer', async () => {
    const email = uniqueEmail();
    const me = browser();
    await me('POST', '/account/register', { email, name: 'Jamie', password: 'a-good-password' });

    await me('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } },
    });
    const quote = await me('POST', '/checkout/quote', { address: { state: 'CA', zip: '90012' } });
    const placed = await me('POST', '/checkout/orders', {
      email: 'different-address@example.com',
      shippingAddress: address,
      shippingMethodCode: 'standard',
      expectedTotalCents: quote.body.totals.totalCents,
    });
    expect(placed.status).toBe(201);
    expect((await me('GET', '/account/orders')).body.orders.map((o: any) => o.number)).toEqual([placed.body.number]);
    expect((await me('GET', '/account/me')).body.customer.lastShippingAddress).toMatchObject({ city: 'Los Angeles' });

    const again = await me('POST', `/account/orders/${placed.body.number}/reorder`);
    expect(again.body).toEqual({ added: 1, skipped: [] });
    expect((await me('GET', '/cart')).body.itemCount).toBe(1);
    expect((await browser()('POST', `/account/orders/${placed.body.number}/reorder`)).status).toBe(401);

    // Same customer on another device: signing in brings the saved cart.
    const phone = browser();
    expect((await phone('GET', '/cart')).body.itemCount).toBe(0);
    await phone('POST', '/account/sign-in', { email, password: 'a-good-password' });
    expect((await phone('GET', '/cart')).body.itemCount).toBe(1);

    const stranger = browser();
    await stranger('POST', '/account/register', { email: uniqueEmail(), name: 'Other', password: 'a-good-password' });
    expect((await stranger('POST', `/account/orders/${placed.body.number}/reorder`)).status).toBe(404);
  });

  it('changes the name and the password while signed in', async () => {
    const email = uniqueEmail();
    const me = browser();
    await me('POST', '/account/register', { email, name: 'Jamie', password: 'a-good-password' });
    const other = browser();
    await other('POST', '/account/sign-in', { email, password: 'a-good-password' });

    expect((await me('PATCH', '/account/profile', { name: 'Jamie Rivera' })).body.customer.name).toBe('Jamie Rivera');
    expect((await me('POST', '/account/password', { currentPassword: 'wrong-password', newPassword: 'a-newer-password' })).status).toBe(401);
    expect((await me('POST', '/account/password', { currentPassword: 'a-good-password', newPassword: 'a-newer-password' })).status).toBe(204);
    expect((await me('GET', '/account/me')).body.customer.name).toBe('Jamie Rivera');
    expect((await other('GET', '/account/me')).body.customer).toBeNull();
    expect((await browser()('POST', '/account/sign-in', { email, password: 'a-newer-password' })).status).toBe(200);
  });
});
