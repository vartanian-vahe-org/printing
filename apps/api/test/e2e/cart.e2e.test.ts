/**
 * Guest cart over HTTP against a running API (see api.e2e.test.ts).
 * Prices are whatever the seeded pricing migration says: the tests compare against /quote, not constants.
 */
import { describe, expect, it } from 'vitest';
import { testHeaders } from './helpers.js';

const base = process.env.API_BASE_URL ?? 'http://localhost:4000';

const selection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: '3d',
};

const templateDesign = { mode: 'template', templateCode: 'classic', values: { name: 'Jamie Rivera' } };

/** A browser-like client that keeps the cart cookie. */
function client() {
  let cookie: string | null = null;
  return {
    get cookie() {
      return cookie;
    },
    async call(method: string, path: string, body?: unknown) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...testHeaders,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]!;
      return { status: res.status, setCookie, body: (await res.json()) as Record<string, any> };
    },
  };
}

async function quoteTotal(quantity: number): Promise<number> {
  const res = await fetch(`${base}/quotes`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ productCode: 'business-cards', selection, quantity }),
  });
  return ((await res.json()) as { totalCents: number }).totalCents;
}

async function uploadPdf(): Promise<string> {
  const pdf = new Blob(['%PDF-1.4\n%e2e\n'], { type: 'application/pdf' });
  const presign = await fetch(`${base}/uploads/presign`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'artwork', filename: 'card.pdf', contentType: pdf.type, sizeBytes: pdf.size }),
  });
  const { key, uploadUrl, headers } = (await presign.json()) as { key: string; uploadUrl: string; headers: Record<string, string> };
  expect((await fetch(uploadUrl, { method: 'PUT', headers, body: pdf })).status).toBe(200);
  return key;
}

describe('guest cart', () => {
  it('is empty without a cookie and sets none', async () => {
    const c = client();
    const res = await c.call('GET', '/cart');
    expect(res.status).toBe(200);
    expect(res.setCookie).toBeNull();
    expect(res.body).toMatchObject({ items: [], itemCount: 0, subtotalCents: 0 });
  });

  it('creates the cart on first add with an httpOnly cookie, prices on the server', async () => {
    const c = client();
    const res = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: templateDesign,
    });
    expect(res.status).toBe(201);
    expect(res.setCookie).toMatch(/^cart=[^;]+;.*HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    expect(res.body.itemCount).toBe(1);
    expect(res.body.subtotalCents).toBe(await quoteTotal(500));
    expect(res.body.items[0]).toMatchObject({ quantity: 500, priceChanged: false, issues: [] });

    // Second add reuses the same cart (no new cookie).
    const again = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 250 },
      design: templateDesign,
    });
    expect(again.setCookie).toBeNull();
    expect(again.body.itemCount).toBe(2);
  });

  it('changes quantity to another tier and removes items', async () => {
    const c = client();
    const added = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: templateDesign,
    });
    const id = added.body.items[0].id as string;

    const updated = await c.call('PATCH', `/cart/items/${id}`, { quantity: 1000 });
    expect(updated.status).toBe(200);
    expect(updated.body.items[0].quantity).toBe(1000);
    expect(updated.body.subtotalCents).toBe(await quoteTotal(1000));

    expect((await c.call('PATCH', `/cart/items/${id}`, { quantity: 777 })).status).toBe(400);

    const removed = await c.call('DELETE', `/cart/items/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.items).toEqual([]);
  });

  it('cannot touch items of another cart', async () => {
    const owner = client();
    const added = await owner.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: templateDesign,
    });
    const id = added.body.items[0].id as string;

    const stranger = client();
    expect((await stranger.call('DELETE', `/cart/items/${id}`)).status).toBe(404);
    await stranger.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: templateDesign,
    });
    expect((await stranger.call('PATCH', `/cart/items/${id}`, { quantity: 1000 })).status).toBe(404);
    expect((await owner.call('GET', '/cart')).body.items[0].quantity).toBe(500);
  });

  it('rejects invalid configurations and designs', async () => {
    const c = client();
    const add = (configuration: unknown, design: unknown) =>
      c.call('POST', '/cart/items', { productCode: 'business-cards', configuration, design });

    expect((await add({ selection: { ...selection, paper: 'nope' }, quantity: 500 }, templateDesign)).status).toBe(400);
    expect((await add({ selection, quantity: 333 }, templateDesign)).status).toBe(400);
    expect((await add({ selection, quantity: 500 }, { ...templateDesign, templateCode: 'nope' })).status).toBe(400);

    const missingFile = await add(
      { selection, quantity: 500 },
      { mode: 'upload', front: { key: 'artwork/2026/10/00000000-0000-0000-0000-000000000000.pdf', fileName: 'x.pdf', pageCount: 2 } },
    );
    expect(missingFile.status).toBe(400);
    expect(missingFile.body.message).toMatch(/not found/i);

    const foreignKey = await add(
      { selection, quantity: 500 },
      { mode: 'upload', front: { key: 'logos/2026/10/00000000-0000-0000-0000-000000000000.png', fileName: 'x.pdf', pageCount: 2 } },
    );
    expect(foreignKey.status).toBe(400);
    expect(c.cookie).toBeNull();
  });

  it('accepts an uploaded PDF, but needs a back design for 2-sided printing', async () => {
    const c = client();
    const key = await uploadPdf();
    const add = (pageCount: number) =>
      c.call('POST', '/cart/items', {
        productCode: 'business-cards',
        configuration: { selection, quantity: 500 },
        design: { mode: 'upload', front: { key, fileName: 'card.pdf', pageCount } },
      });

    expect((await add(1)).status).toBe(400);
    const ok = await add(2);
    expect(ok.status).toBe(201);
    expect(ok.body.items[0].design).toMatchObject({ mode: 'upload', front: { key, fileName: 'card.pdf' } });
  });

  it('keeps only the template text fields it knows', async () => {
    const c = client();
    const res = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { ...templateDesign, values: { name: 'Jamie', bogus: 'x' } },
    });
    expect(res.status).toBe(201);
    expect(res.body.items[0].design.values).toEqual({ name: 'Jamie' });
  });

  it('refuses characters the template fonts cannot print', async () => {
    const c = client();
    const res = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { ...templateDesign, values: { name: 'Jamie 😀' } },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Full name: these characters cannot be printed: 😀');
    const accents = await c.call('POST', '/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { ...templateDesign, values: { name: 'Nguyễn Văn Đức — Café' } },
    });
    expect(accents.status).toBe(201);
  });
});
