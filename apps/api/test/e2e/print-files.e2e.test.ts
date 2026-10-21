/**
 * Print files (Phase 2 step 7) through the admin API: page count and size, trim/bleed boxes,
 * embedded template fonts, the customer's logo, and uploaded PDFs passed through.
 */
import { PDFDocument, PDFName, type PDFDict } from 'pdf-lib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { address, base, selection, testHeaders, uniqueEmail } from './helpers.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');
let adminCookie = '';

beforeAll(async () => {
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  adminCookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

async function upload(kind: 'artwork' | 'logo', bytes: Uint8Array, contentType: string, filename: string): Promise<string> {
  const presign = await fetch(`${base}/uploads/presign`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ kind, filename, contentType, sizeBytes: bytes.byteLength }),
  });
  const { key, uploadUrl, headers } = (await presign.json()) as { key: string; uploadUrl: string; headers: Record<string, string> };
  expect((await fetch(uploadUrl, { method: 'PUT', headers, body: bytes })).status).toBe(200);
  return key;
}

async function order(design: unknown, printedSide = 'front_back'): Promise<number> {
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
  const added = await call('/cart/items', {
    productCode: 'business-cards',
    configuration: { selection: { ...selection, printed_side: printedSide }, quantity: 500 },
    design,
  });
  expect(added.items).toHaveLength(1);
  const quote = await call('/checkout/quote', { address: { state: 'CA', zip: '90012' } });
  const placed = await call('/checkout/orders', {
    email: uniqueEmail(),
    shippingAddress: address,
    shippingMethodCode: 'standard',
    expectedTotalCents: quote.totals.totalCents,
  });
  return placed.number as number;
}

async function printFile(number: number, item = 1) {
  const res = await fetch(`${base}/admin/orders/${number}/items/${item}/print-file`, { headers: { cookie: adminCookie } });
  return { res, pdf: res.ok ? await PDFDocument.load(new Uint8Array(await res.arrayBuffer())) : null };
}

function fontNames(pdf: PDFDocument): string[] {
  return pdf.getPages().flatMap((page) => {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font')) as PDFDict | undefined;
    return fonts ? fonts.keys().map((k) => String((pdf.context.lookup(fonts.get(k)) as PDFDict).get(PDFName.of('BaseFont')))) : [];
  });
}

describe('print files', () => {
  it('draws a template card at bleed size with trim box, Inter embedded and the logo', async () => {
    const logo = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 31, g: 94, b: 255, alpha: 1 } } }).png().toBuffer();
    const logoKey = await upload('logo', new Uint8Array(logo), 'image/png', 'logo.png');
    const number = await order({
      mode: 'template',
      templateCode: 'classic',
      values: { name: 'Jamie Rivera', company: 'Rivera Print Co.', email: 'jamie@riveraprint.co' },
      logoKey,
    });

    const { res, pdf } = await printFile(number);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="order-${number}-item-1.pdf"`);
    expect(pdf!.getPageCount()).toBe(2);

    const page = pdf!.getPage(0);
    // 3.5" x 2" + 1/8" bleed on each side = 270 x 162 pt; trim box inset by the bleed.
    expect(page.getMediaBox()).toMatchObject({ x: 0, y: 0, width: 270, height: 162 });
    expect(page.getTrimBox()).toMatchObject({ x: 9, y: 9, width: 252, height: 144 });
    expect(page.getBleedBox()).toMatchObject({ width: 270, height: 162 });
    expect(fontNames(pdf!).some((n) => n.includes('Inter'))).toBe(true);
    const images = page.node.Resources()?.lookup(PDFName.of('XObject')) as PDFDict | undefined;
    expect(images?.keys().length).toBe(1);
  });

  it('makes one page when the back is blank', async () => {
    const number = await order({ mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } }, 'front_only');
    expect((await printFile(number)).pdf!.getPageCount()).toBe(1);
  });

  it('passes an uploaded 2-page PDF through as front and back', async () => {
    const source = await PDFDocument.create();
    source.addPage([270, 162]);
    source.addPage([270, 162]);
    const key = await upload('artwork', await source.save(), 'application/pdf', 'card.pdf');
    const number = await order({ mode: 'upload', front: { key, fileName: 'card.pdf', pageCount: 2 } });

    const { res, pdf } = await printFile(number);
    expect(res.status).toBe(200);
    expect(pdf!.getPageCount()).toBe(2);
    expect(pdf!.getPage(1).getSize()).toEqual({ width: 270, height: 162 });
  });

  it('404s for an unknown item and needs a session', async () => {
    const number = await order({ mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } });
    expect((await printFile(number, 2)).res.status).toBe(404);
    expect((await fetch(`${base}/admin/orders/${number}/items/1/print-file`)).status).toBe(401);
  });
});
