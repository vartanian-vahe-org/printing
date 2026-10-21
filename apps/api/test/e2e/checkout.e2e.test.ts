/**
 * Guest checkout over HTTP against a running API (see api.e2e.test.ts).
 * Expected shipping and tax come from the seeded defaults (flat rates, CA 7.25%).
 */
import { describe, expect, it } from 'vitest';
import { testHeaders, uniqueEmail } from './helpers.js';

const base = process.env.API_BASE_URL ?? 'http://localhost:4000';

const selection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: '3d',
};

const address = {
  name: 'Jamie Rivera',
  line1: '100 Main St',
  city: 'Los Angeles',
  state: 'CA',
  zip: '90012',
  phone: '(213) 555-0100',
};

/** A browser-like client that keeps the cart cookie. */
function client() {
  let cookie: string | null = null;
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...testHeaders,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
}

async function clientWithCart(quantity = 500) {
  const call = client();
  const added = await call('POST', '/cart/items', {
    productCode: 'business-cards',
    configuration: { selection, quantity },
    design: { mode: 'template', templateCode: 'classic', values: { name: 'Jamie Rivera' } },
  });
  expect(added.status).toBe(201);
  return call;
}

describe('POST /checkout/quote', () => {
  it('refuses an empty cart', async () => {
    expect((await client()('POST', '/checkout/quote', {})).status).toBe(400);
  });

  it('needs a state and ZIP before shipping and tax are known', async () => {
    const call = await clientWithCart();
    const res = await call('POST', '/checkout/quote', {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shippingOptions: [], shippingMethodCode: null, tax: null, ready: false });
    expect(res.body.payment.provider).toBe('manual');
    expect(res.body.totals.totalCents).toBe(res.body.cart.subtotalCents);
  });

  it('prices shipping and California tax on the merchandise only', async () => {
    const call = await clientWithCart();
    const res = await call('POST', '/checkout/quote', { address: { state: 'ca', zip: '90012' }, shippingMethodCode: 'expedited' });
    expect(res.status).toBe(200);
    const { subtotalCents, shippingCents, taxCents, totalCents } = res.body.totals;
    expect(res.body.shippingOptions.map((o: any) => o.code)).toEqual(['standard', 'expedited', 'overnight']);
    expect(res.body.shippingMethodCode).toBe('expedited');
    expect(shippingCents).toBe(res.body.shippingOptions[1].priceCents);
    expect(res.body.tax.rateBps).toBe(725);
    expect(taxCents).toBe(Math.floor((subtotalCents * 725 + 5000) / 10000));
    expect(totalCents).toBe(subtotalCents + shippingCents + taxCents);
    expect(res.body.ready).toBe(true);
  });

  it('collects no tax for states without a rate', async () => {
    const call = await clientWithCart();
    const res = await call('POST', '/checkout/quote', { address: { state: 'NV', zip: '89101' } });
    expect(res.body.tax).toMatchObject({ rateBps: 0, taxCents: 0 });
  });

  it('makes standard shipping free above its threshold', async () => {
    const call = await clientWithCart(5000);
    const res = await call('POST', '/checkout/quote', { address: { state: 'CA', zip: '90012' } });
    expect(res.body.cart.subtotalCents).toBeGreaterThanOrEqual(10000);
    expect(res.body.shippingOptions[0]).toMatchObject({ code: 'standard', isFree: true, priceCents: 0 });
  });
});

describe('POST /checkout/orders', () => {
  async function expectedTotal(call: ReturnType<typeof client>, shippingMethodCode = 'standard') {
    const q = await call('POST', '/checkout/quote', { address: { state: address.state, zip: address.zip }, shippingMethodCode });
    return q.body.totals.totalCents as number;
  }

  it('places an order, empties the cart and opens the order page with its token only', async () => {
    const call = await clientWithCart();
    const total = await expectedTotal(call);
    const email = uniqueEmail();
    const res = await call('POST', '/checkout/orders', {
      email: ` ${email.toUpperCase()} `,
      shippingAddress: { ...address, company: '  ' },
      shippingMethodCode: 'standard',
      expectedTotalCents: total,
    });
    expect(res.status).toBe(201);
    expect(res.body.number).toBeGreaterThanOrEqual(100001);
    expect(res.body.totalCents).toBe(total);
    expect(res.body.next).toMatchObject({ type: 'manual' });
    expect(res.body.accessToken).toMatch(/^[\w-]{43}$/);

    expect((await call('GET', '/cart')).body.items).toEqual([]);

    const { number, accessToken } = res.body;
    const order = await call('GET', `/orders/${number}`, undefined, { 'x-order-token': accessToken });
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({
      number,
      status: 'placed',
      paymentStatus: 'unpaid',
      email,
      shippingAddress: address,
      totalCents: total,
    });
    expect(order.body.shippingAddress).not.toHaveProperty('company');
    expect(order.body.items[0].summary[0]).toEqual({ label: 'Size', value: expect.any(String) });
    expect(order.body.paymentInstructions).toContain(`#${number}`);

    expect((await call('GET', `/orders/${number}`, undefined, { 'x-order-token': 'wrong' })).status).toBe(404);
    expect((await call('GET', `/orders/${number}`)).status).toBe(404);
  });

  it('refuses when the total differs from what the customer saw', async () => {
    const call = await clientWithCart();
    const res = await call('POST', '/checkout/orders', {
      email: uniqueEmail(),
      shippingAddress: address,
      shippingMethodCode: 'standard',
      expectedTotalCents: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('total_changed');
    expect(res.body.totals.totalCents).toBe(await expectedTotal(call));
    expect((await call('GET', '/cart')).body.itemCount).toBe(1);
  });

  it('refuses an unknown shipping method and an invalid address', async () => {
    const call = await clientWithCart();
    const unknown = await call('POST', '/checkout/orders', {
      email: uniqueEmail(),
      shippingAddress: address,
      shippingMethodCode: 'teleport',
      expectedTotalCents: 0,
    });
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe('shipping_unavailable');

    const invalid = await call('POST', '/checkout/orders', {
      email: 'not-an-email',
      shippingAddress: { ...address, state: 'ZZ', zip: '123', phone: '555-0100' },
      shippingMethodCode: 'standard',
      expectedTotalCents: 0,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^email:/),
        expect.stringMatching(/^shippingAddress\.state:/),
        expect.stringMatching(/^shippingAddress\.zip:/),
        expect.stringMatching(/^shippingAddress\.phone:/),
      ]),
    );
  });

  it('creates one order when the same cart is submitted twice at once', async () => {
    const call = await clientWithCart();
    const body = { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: await expectedTotal(call) };
    const results = await Promise.all([call('POST', '/checkout/orders', body), call('POST', '/checkout/orders', body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it('refuses without a cart', async () => {
    const res = await client()('POST', '/checkout/orders', {
      email: uniqueEmail(),
      shippingAddress: address,
      shippingMethodCode: 'standard',
      expectedTotalCents: 0,
    });
    expect(res.status).toBe(400);
  });
});
