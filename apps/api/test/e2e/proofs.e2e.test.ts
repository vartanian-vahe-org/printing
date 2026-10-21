/**
 * File check and proof (Phase 2 step 8) end to end, with the Python prepress worker running:
 * proof images, warnings to confirm, errors that need a new file, approvals, emails.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { address, base, customerOrder, searchMail, selection, testHeaders, uniqueEmail, waitFor, waitForProofs } from './helpers.js';

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');
let adminCookie = '';

beforeAll(async () => {
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

/** A 2-page card PDF at bleed size; `embedFont` false uses a standard font that is not embedded. */
async function cardPdf(embedFont: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const interPath = join(dirname(require.resolve('@expo-google-fonts/inter/package.json')), '700Bold/Inter_700Bold.ttf');
  const font = embedFont ? await doc.embedFont(readFileSync(interPath)) : await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ['FRONT', 'BACK']) {
    const page = doc.addPage([270, 162]);
    page.drawRectangle({ x: 0, y: 0, width: 270, height: 162, color: rgb(0.1, 0.3, 0.6) });
    page.drawText(label, { x: 40, y: 70, size: 24, font, color: rgb(1, 1, 1) });
  }
  return doc.save();
}

async function uploadPdf(bytes: Uint8Array, fileName: string) {
  const presign = await fetch(`${base}/uploads/presign`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'artwork', filename: fileName, contentType: 'application/pdf', sizeBytes: bytes.byteLength }),
  });
  const { key, uploadUrl, headers } = (await presign.json()) as { key: string; uploadUrl: string; headers: Record<string, string> };
  await fetch(uploadUrl, { method: 'PUT', headers, body: bytes });
  return { key, fileName, pageCount: 2 };
}

async function placeOrder(email: string, design: unknown): Promise<{ number: number; accessToken: string }> {
  let cookie = '';
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...testHeaders, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return (await res.json()) as Record<string, any>;
  };
  await call('/cart/items', { productCode: 'business-cards', configuration: { selection, quantity: 500 }, design });
  const quote = await call('/checkout/quote', { address: { state: 'CA', zip: '90012' } });
  return (await call('/checkout/orders', {
    email,
    shippingAddress: address,
    shippingMethodCode: 'standard',
    expectedTotalCents: quote.totals.totalCents,
  })) as { number: number; accessToken: string };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...testHeaders, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('proofs', () => {
  it('template order: proof images, approval by the customer, proof-ready email', async () => {
    const email = uniqueEmail();
    const order = await placeOrder(email, { mode: 'template', templateCode: 'classic', values: { name: 'Jamie Rivera' } });
    const checked = await waitForProofs(order.number, order.accessToken);
    const item = checked.items[0];
    expect(item.proof).toMatchObject({ status: 'awaiting_customer', issues: [], checkFailed: false });
    expect(item.proof.images.map((i: any) => i.page)).toEqual([1, 2]);
    const image = await fetch(item.proof.images[0].url);
    expect(image.headers.get('content-type')).toBe('image/png');

    // The proof link needs the order's secret.
    expect((await post(`/orders/${order.number}/items/1/proof/approve`, {}, { 'x-order-token': 'wrong' })).status).toBe(404);
    expect((await post(`/orders/${order.number}/items/1/proof/approve`, {}, { 'x-order-token': order.accessToken })).status).toBe(204);
    expect((await post(`/orders/${order.number}/items/1/proof/approve`, {}, { 'x-order-token': order.accessToken })).status).toBe(409);

    const after = await customerOrder(order.number, order.accessToken);
    expect(after).toMatchObject({ proofStatus: 'approved' });
    expect(after.items[0].proof.approvedAt).toBeTruthy();
    const mail = await waitFor(async () => (await searchMail(`to:"${email}" subject:"proof"`))[0]);
    expect(mail.Subject).toContain('Your proof for order');
  });

  it('upload with a font that is not embedded: new file needed, then a good file with warnings to confirm', async () => {
    const email = uniqueEmail();
    const bad = await uploadPdf(await cardPdf(false), 'card.pdf');
    const order = await placeOrder(email, { mode: 'upload', front: bad });
    const first = await waitForProofs(order.number, order.accessToken);
    expect(first.items[0].proof.status).toBe('needs_new_file');
    expect(first.items[0].proof.issues.map((i: any) => `${i.code}/${i.level}`)).toContain('font-not-embedded/error');
    expect((await post(`/orders/${order.number}/items/1/proof/approve`, {}, { 'x-order-token': order.accessToken })).status).toBe(409);
    await waitFor(async () => (await searchMail(`to:"${email}" subject:"new file"`))[0]);

    const good = await uploadPdf(await cardPdf(true), 'card-v2.pdf');
    const replaced = await post(`/orders/${order.number}/items/1/file`, { front: good }, { 'x-order-token': order.accessToken });
    expect(replaced.status).toBe(202);
    const second = await waitForProofs(order.number, order.accessToken);
    const proof = second.items[0].proof;
    expect(proof.status).toBe('awaiting_customer');
    expect(proof.issues.map((i: any) => i.id).sort()).toEqual(['rgb@1', 'rgb@2']);
    expect(second.items[0].design.front.fileName).toBe('card-v2.pdf');

    const partial = await post(`/orders/${order.number}/items/1/proof/approve`, { acknowledged: ['rgb@1'] }, { 'x-order-token': order.accessToken });
    expect(partial.status).toBe(400);
    const full = await post(`/orders/${order.number}/items/1/proof/approve`, { acknowledged: ['rgb@1', 'rgb@2'] }, { 'x-order-token': order.accessToken });
    expect(full.status).toBe(204);
  });

  it('staff can re-run the check and approve for the customer', async () => {
    const order = await placeOrder(uniqueEmail(), { mode: 'template', templateCode: 'minimal', values: { name: 'Jamie' } });
    await waitForProofs(order.number, order.accessToken);
    const admin = (path: string) => fetch(`${base}/admin/orders/${order.number}${path}`, { method: 'POST', headers: { cookie: adminCookie } });

    expect((await admin('/items/1/preflight')).status).toBe(202);
    const again = await waitForProofs(order.number, order.accessToken);
    expect(again.items[0].proof.status).toBe('awaiting_customer');
    expect((await admin('/items/1/proof/approve')).status).toBe(204);

    const detail = (await (await fetch(`${base}/admin/orders/${order.number}`, { headers: { cookie: adminCookie } })).json()) as any;
    expect(detail.proofStatus).toBe('approved');
    expect(detail.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['preflight', 'preflight_requested', 'proof_approved']));
  });

  it('refuses a replacement file for a template item', async () => {
    const order = await placeOrder(uniqueEmail(), { mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } });
    await waitForProofs(order.number, order.accessToken);
    const file = await uploadPdf(await cardPdf(true), 'card.pdf');
    expect((await post(`/orders/${order.number}/items/1/file`, { front: file }, { 'x-order-token': order.accessToken })).status).toBe(409);
  });
});
