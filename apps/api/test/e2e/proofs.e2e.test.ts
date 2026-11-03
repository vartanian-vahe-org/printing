/**
 * File check and proof (Phase 2 step 8) end to end, with the Python prepress worker running:
 * proof images, warnings to confirm, replacement files, approvals, emails. Customer files with
 * errors never reach an order: the upload check refuses them before the cart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { cmyk, PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { address, base, checkArtwork, checkedArtwork, customerOrder, searchMail, selection, testHeaders, uniqueEmail, uploadArtwork, waitFor, waitForProofs } from './helpers.js';

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

/**
 * A 2-page CMYK card PDF; `embedFont` false uses a standard font that is not embedded, `bleed` false
 * makes pages of the finished card size (a warning to confirm).
 */
async function cardPdf({ embedFont = true, bleed = true } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const interPath = join(dirname(require.resolve('@expo-google-fonts/inter/package.json')), '700Bold/Inter_700Bold.ttf');
  const font = embedFont ? await doc.embedFont(readFileSync(interPath)) : await doc.embedFont(StandardFonts.Helvetica);
  const [width, height] = bleed ? [270, 162] : [252, 144];
  for (const label of ['FRONT', 'BACK']) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: cmyk(0.9, 0.6, 0, 0.2) });
    page.drawText(label, { x: 40, y: 60, size: 24, font, color: cmyk(0, 0, 0, 0) });
  }
  return doc.save();
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

  it('upload with a font that is not embedded is refused before the cart', async () => {
    const bad = await checkArtwork(await uploadArtwork(await cardPdf({ embedFont: false }), 'card.pdf'));
    expect(bad.issues.map((i) => `${i.code}/${i.level}`)).toContain('font-not-embedded/error');
    const cart = await post('/cart/items', {
      productCode: 'business-cards',
      configuration: { selection, quantity: 500 },
      design: { mode: 'upload', front: { key: bad.outputKey, fileName: 'card.pdf', pageCount: 2 } },
    });
    expect(cart.status).toBe(400);
  });

  it('upload with warnings to confirm, then a replacement file that is checked again', async () => {
    const email = uniqueEmail();
    const noBleed = await checkedArtwork(await cardPdf({ bleed: false }), 'card.pdf');
    const order = await placeOrder(email, { mode: 'upload', front: noBleed });
    const first = await waitForProofs(order.number, order.accessToken);
    const proof = first.items[0].proof;
    expect(proof.status).toBe('awaiting_customer');
    expect(proof.issues.map((i: any) => i.id).sort()).toEqual(['no-bleed@1', 'no-bleed@2']);
    const partial = await post(`/orders/${order.number}/items/1/proof/approve`, { acknowledged: ['no-bleed@1'] }, { 'x-order-token': order.accessToken });
    expect(partial.status).toBe(400);

    // A replacement must pass the same check as before ordering.
    const raw = await uploadArtwork(await cardPdf(), 'card-v2.pdf');
    const unchecked = await post(`/orders/${order.number}/items/1/file`, { front: { key: raw, fileName: 'card-v2.pdf', pageCount: 2 } }, { 'x-order-token': order.accessToken });
    expect(unchecked.status).toBe(400);
    const good = await checkedArtwork(await cardPdf(), 'card-v2.pdf');
    const replaced = await post(`/orders/${order.number}/items/1/file`, { front: good }, { 'x-order-token': order.accessToken });
    expect(replaced.status).toBe(202);
    const second = await waitForProofs(order.number, order.accessToken);
    expect(second.items[0].proof).toMatchObject({ status: 'awaiting_customer', issues: [] });
    expect(second.items[0].design.front.fileName).toBe('card-v2.pdf');
    expect((await post(`/orders/${order.number}/items/1/proof/approve`, {}, { 'x-order-token': order.accessToken })).status).toBe(204);
    await waitFor(async () => (await searchMail(`to:"${email}" subject:"proof"`))[0]);
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
    const file = await checkedArtwork(await cardPdf(), 'card.pdf');
    expect((await post(`/orders/${order.number}/items/1/file`, { front: file }, { 'x-order-token': order.accessToken })).status).toBe(409);
  });
  it('template approved when added to the cart: no proof to approve after ordering', async () => {
    const email = uniqueEmail();
    const order = await placeOrder(email, { mode: 'template', templateCode: 'classic', values: { name: 'Jamie Rivera' }, reviewed: true });
    const placed = await customerOrder(order.number, order.accessToken);
    expect(placed.items[0].proof).toMatchObject({ status: 'approved', approvedAt: expect.any(String) });
    // The print file and proof images are still made, and the approval stays.
    const checked = await waitFor(async () => {
      const o = await customerOrder(order.number, order.accessToken);
      return o.items[0].proof.images.length > 0 ? o : undefined;
    });
    expect(checked.items[0].proof.status).toBe('approved');
    expect(checked.proofStatus).toBe('approved');
    const confirmation = await waitFor(async () => (await searchMail(`to:"${email}" subject:"received"`))[0]);
    expect(confirmation).toBeTruthy();
    // No proof-ready email for a design approved up front.
    expect(await searchMail(`to:"${email}" subject:"proof"`)).toHaveLength(0);
  });

  it('upload with "print right away": approved once the file check passes', async () => {
    const pdf = await checkedArtwork(await cardPdf(), 'ready.pdf');
    const order = await placeOrder(uniqueEmail(), { mode: 'upload', front: pdf, proof: 'skip' });
    const checked = await waitForProofs(order.number, order.accessToken);
    expect(checked.items[0].proof.status).toBe('approved');
    expect(checked.items[0].design.proof).toBe('skip');
  });
});
