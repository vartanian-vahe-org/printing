/** Daily cleanup (S11, X2): unused uploads go, files on orders stay. Run on demand by the owner. */
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { address, base, selection, testHeaders, uniqueEmail } from './helpers.js';

const ownerEmail = process.env.ADMIN_EMAIL;
const ownerPassword = process.env.ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

async function uploadPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([270, 162]);
  doc.addPage([270, 162]);
  const bytes = await doc.save();
  const presign = await fetch(`${base}/uploads/presign`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'artwork', filename: 'card.pdf', contentType: 'application/pdf', sizeBytes: bytes.byteLength }),
  });
  const { key, uploadUrl, headers } = (await presign.json()) as { key: string; uploadUrl: string; headers: Record<string, string> };
  await fetch(uploadUrl, { method: 'PUT', headers, body: bytes });
  return key;
}

/** Adds the file to a fresh cart: 201 while it exists, 400 "not found" once deleted. */
const addToCart = (key: string) =>
  fetch(`${base}/cart/items`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ productCode: 'business-cards', configuration: { selection, quantity: 500 }, design: { mode: 'upload', front: { key, fileName: 'card.pdf', pageCount: 2 } } }),
  }).then((r) => r.status);

describe('cleanup', () => {
  it('deletes uploads nobody uses and keeps those on orders', async () => {
    const login = await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ownerEmail, password: ownerPassword }) });
    const owner = login.headers.get('set-cookie')!.split(';')[0]!;

    const orphan = await uploadPdf();
    const kept = await uploadPdf();
    // Put `kept` on an order.
    let cookie = '';
    const call = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { ...testHeaders, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
      cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      return (await res.json()) as Record<string, any>;
    };
    await call('/cart/items', { productCode: 'business-cards', configuration: { selection, quantity: 500 }, design: { mode: 'upload', front: { key: kept, fileName: 'card.pdf', pageCount: 2 } } });
    const quote = await call('/checkout/quote', { address: { state: 'CA', zip: '90012' } });
    await call('/checkout/orders', { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: quote.totals.totalCents });

    const staffOnly = await fetch(`${base}/admin/maintenance/cleanup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(staffOnly.status).toBe(401);
    const run = await fetch(`${base}/admin/maintenance/cleanup`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ uploadsOlderThanDays: 0 }),
    });
    expect(run.status).toBe(200);
    const result = (await run.json()) as { uploads: number; carts: number };
    expect(result.uploads).toBeGreaterThanOrEqual(1);

    expect(await addToCart(orphan)).toBe(400);
    expect(await addToCart(kept)).toBe(201);
  });
});
