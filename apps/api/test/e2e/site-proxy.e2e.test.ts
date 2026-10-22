/**
 * The storefront's /api proxy (how the sites reach the API from Vercel), tested through the local
 * web server: cookies on the site's domain, order tokens, binary files, and per-visitor rate limits
 * from the visitor IP the proxy forwards with the shared secret.
 */
import { describe, expect, it } from 'vitest';
import { address, selection, uniqueEmail } from './helpers.js';

const site = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const ownerEmail = process.env.ADMIN_EMAIL;
const ownerPassword = process.env.ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

/** On Vercel the platform sets X-Real-IP to the visitor; locally the test plays the visitor. */
const visitorIp = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

function siteBrowser(ip = visitorIp()) {
  const cookies = new Map<string, string>();
  return async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${site}/api${path}`, {
      method,
      headers: {
        'x-real-ip': ip,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair!.split('=') as [string, string];
      if (value) cookies.set(name, value);
    }
    return res;
  };
}

describe('site /api proxy', () => {
  it('keeps the cart cookie on the site and passes order tokens', async () => {
    const call = siteBrowser();
    const added = await call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { mode: 'template', templateCode: 'classic', values: { name: 'Proxy Test' } },
    });
    expect(added.status).toBe(201);
    expect(added.headers.getSetCookie()[0]).toMatch(/^cart=[^;]+;.*HttpOnly/);
    expect(((await (await call('GET', '/cart')).json()) as any).itemCount).toBe(1);

    const quote = (await (await call('POST', '/checkout/quote', { address: { state: 'CA', zip: '90012' } })).json()) as any;
    const placed = (await (
      await call('POST', '/checkout/orders', { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: quote.totals.totalCents })
    ).json()) as any;
    const order = await call('GET', `/orders/${placed.number}`, undefined, { 'x-order-token': placed.accessToken });
    expect(order.status).toBe(200);
    expect(((await order.json()) as any).number).toBe(placed.number);
  });

  it('passes binary downloads and the admin session through', async () => {
    const admin = siteBrowser();
    const login = await admin('POST', '/admin/auth/login', { email: ownerEmail, password: ownerPassword });
    expect(login.status).toBe(200);
    const list = (await (await admin('GET', '/admin/orders?view=all')).json()) as any;
    const number = list.orders[0].number;
    const file = await admin('GET', `/admin/orders/${number}/items/1/print-file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('content-disposition')).toContain(`order-${number}-item-1.pdf`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('counts rate limits per visitor, not for the proxy as a whole', async () => {
    const ip = visitorIp();
    const tryOrder = (from: string) =>
      siteBrowser(from)('POST', '/checkout/orders', { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: 0 }).then((r) => r.status);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push(await tryOrder(ip));
    expect(statuses[20]).toBe(429);
    // Another visitor behind the same proxy is not affected.
    expect(await tryOrder(visitorIp())).toBe(400);
  });
});
