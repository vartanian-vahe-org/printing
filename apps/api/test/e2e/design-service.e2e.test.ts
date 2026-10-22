/**
 * Choosing a design (product page step 2) end to end: template filters, "let us design it for you"
 * packages priced into the cart and order, the designer's delivery through the file check, change
 * requests limited by the package, and the admin settings behind them.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { address, base, customerOrder, selection, testHeaders, uniqueEmail, waitFor } from './helpers.js';

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');
let admin = '';

/** 1×1 transparent PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { ...testHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  admin = res.headers.get('set-cookie')!.split(';')[0]!;
});

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...testHeaders, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], body: text ? (JSON.parse(text) as any) : null };
}

async function upload(kind: 'artwork' | 'reference', bytes: Uint8Array, fileName: string, contentType: string) {
  const presign = await request('POST', '/uploads/presign', { kind, filename: fileName, contentType, sizeBytes: bytes.byteLength });
  expect(presign.status).toBe(201);
  await fetch(presign.body.uploadUrl, { method: 'PUT', headers: presign.body.headers, body: bytes });
  return { key: presign.body.key as string, fileName };
}

/** A 2-page card PDF at bleed size (front and back), as a designer would deliver it. */
async function designPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let page = 0; page < 2; page++) {
    const sheet = doc.addPage([270, 162]);
    sheet.drawRectangle({ x: 0, y: 0, width: 270, height: 162, color: rgb(0.45, 0.3, 0.2) });
    sheet.drawRectangle({ x: 30, y: 60, width: 120, height: 30, color: rgb(1, 1, 1) });
  }
  return doc.save();
}

function serviceDesign(tierCode: string, files: { key: string; fileName: string }[] = []) {
  return { mode: 'service', tierCode, brief: { content: 'Jamie Rivera\nOwner, Rivera Bakery\n(415) 555-0142', notes: 'Warm cream and brown', files } };
}

/** A cart with one item; returns the cart cookie and the add response. */
async function cartWith(design: unknown, quantity = 500) {
  const added = await request('POST', '/cart/items', { productCode: 'business-cards', configuration: { selection, quantity }, design });
  return { cookie: added.cookie ?? '', added };
}

async function printPrice(quantity = 500): Promise<number> {
  return (await request('POST', '/quotes', { productCode: 'business-cards', selection, quantity })).body.totalCents;
}

describe('design choices', () => {
  it('serves template filters with tags, and the design packages', async () => {
    const templates = await request('GET', '/products/business-cards/templates');
    expect(templates.body.facets.map((f: any) => f.code)).toEqual(['industry', 'style', 'color']);
    const midnight = templates.body.templates.find((t: any) => t.code === 'midnight');
    expect(midnight.tags.color).toContain('dark');
    // Values no template uses are left out of the filters.
    for (const facet of templates.body.facets) {
      for (const value of facet.values) expect(templates.body.templates.some((t: any) => t.tags[facet.code]?.includes(value.code))).toBe(true);
    }

    const services = await request('GET', '/products/business-cards/design-services');
    expect(services.body.tiers.map((t: any) => t.code)).toEqual(['standard', 'premium', 'elite']);
    expect(services.body.tiers[0]).toMatchObject({ priceCents: expect.any(Number), designDays: expect.any(Number), features: expect.any(Array) });
  });

  it('adds the design fee once per item and checks the brief', async () => {
    const tiers = (await request('GET', '/products/business-cards/design-services')).body.tiers;
    const premium = tiers.find((t: any) => t.code === 'premium');
    const logo = await upload('reference', PNG, 'logo.png', 'image/png');

    const { cookie, added } = await cartWith(serviceDesign('premium', [logo]));
    expect(added.status).toBe(201);
    const item = added.body.items[0];
    expect(item.totalCents).toBe((await printPrice()) + premium.priceCents);
    expect(item.designService).toEqual({ code: 'premium', name: premium.name, priceCents: premium.priceCents });
    expect(item.summary).toContainEqual({ label: 'Design service', value: expect.stringContaining(premium.name) });

    // Changing the quantity keeps the fee (charged once, not per card).
    const updated = await request('PATCH', `/cart/items/${item.id}`, { quantity: 1000 }, { cookie });
    expect(updated.body.items[0].totalCents).toBe((await printPrice(1000)) + premium.priceCents);

    expect((await cartWith(serviceDesign('platinum'))).added.status).toBe(400);
    expect((await cartWith({ ...serviceDesign('standard'), brief: { content: '  ', notes: '', files: [] } })).added.status).toBe(400);
    const missing = await cartWith(serviceDesign('standard', [{ key: 'references/2026/01/00000000-0000-0000-0000-000000000000.png', fileName: 'x.png' }]));
    expect(missing.added.status).toBe(400);
    // A logo upload is not a reference file.
    const wrongKind = await upload('artwork', await designPdf(), 'x.pdf', 'application/pdf');
    expect((await cartWith(serviceDesign('standard', [wrongKind]))).added.status).toBe(400);
  });

  it('designer delivers, the customer asks for changes within the package, then approves', async () => {
    const standard = (await request('GET', '/products/business-cards/design-services')).body.tiers.find((t: any) => t.code === 'standard');
    expect(standard.revisions).toBe(2);
    const { cookie } = await cartWith(serviceDesign('standard'));
    const quote = await request('POST', '/checkout/quote', { address: { state: 'CA', zip: '90012' } }, { cookie });
    const placed = await request(
      'POST',
      '/checkout/orders',
      { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: quote.body.totals.totalCents },
      { cookie },
    );
    expect(placed.status).toBe(201);
    const { number, accessToken } = placed.body;
    const token = { 'x-order-token': accessToken };

    // Nothing to check until the designer delivers.
    let order = await customerOrder(number, accessToken);
    expect(order.items[0]).toMatchObject({ designService: { name: standard.name, revisions: 2 }, proof: { status: 'awaiting_design', images: [] } });
    expect(order.items[0].totalCents).toBe((await printPrice()) + standard.priceCents);
    expect((await request('POST', `/orders/${number}/items/1/proof/approve`, {}, token)).status).toBe(409);
    expect((await request('POST', `/orders/${number}/items/1/file`, { front: { key: 'artwork/x', fileName: 'x.pdf', pageCount: 2 } }, token)).status).toBe(409);
    expect((await request('GET', `/admin/orders/${number}/items/1/print-file`, undefined, { cookie: admin })).status).toBe(409);

    const deliver = async () => {
      const file = await upload('artwork', await designPdf(), 'design.pdf', 'application/pdf');
      expect((await request('POST', `/admin/orders/${number}/items/1/design`, { front: file }, { cookie: admin })).status).toBe(202);
      return waitFor(async () => {
        const o = await customerOrder(number, accessToken);
        return o.items[0].proof.status === 'awaiting_customer' ? o : undefined;
      });
    };
    const askChanges = (message: string) => request('POST', `/orders/${number}/items/1/proof/changes`, { message }, token);

    order = await deliver();
    expect(order.items[0].proof.images).toHaveLength(2);
    expect(order.items[0].design.artwork.round).toBe(1);
    expect((await askChanges('no')).status).toBe(400);
    expect((await askChanges('Make the logo bigger please')).status).toBe(202);
    order = await customerOrder(number, accessToken);
    expect(order.items[0].proof.status).toBe('awaiting_design');
    expect(order.items[0].design.changeRequests).toHaveLength(1);

    await deliver();
    expect((await askChanges('Darker brown for the background')).status).toBe(202);
    order = await deliver();
    expect(order.items[0].design.artwork.round).toBe(3);
    // Both rounds of the Standard package are used.
    const third = await askChanges('One more change');
    expect(third.status).toBe(409);
    expect(third.body.message).toContain('2 rounds of changes');

    // The customer confirms the file check's notes (e.g. RGB colors), as for an upload.
    const acknowledged = order.items[0].proof.issues.filter((i: any) => i.level === 'warning').map((i: any) => i.id);
    expect((await request('POST', `/orders/${number}/items/1/proof/approve`, { acknowledged }, token)).status).toBe(204);
    expect((await customerOrder(number, accessToken)).items[0].proof.status).toBe('approved');
    // Approved: the designer cannot replace it anymore.
    const late = await upload('artwork', await designPdf(), 'late.pdf', 'application/pdf');
    expect((await request('POST', `/admin/orders/${number}/items/1/design`, { front: late }, { cookie: admin })).status).toBe(409);

    const detail = await request('GET', `/admin/orders/${number}`, undefined, { cookie: admin });
    expect(detail.body.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['design_delivered', 'changes_requested']));
    expect(detail.body.items[0].files.map((f: any) => f.label)).toContain('Designed front PDF');
  });

  it('admins set package prices and template filters', async () => {
    const before = (await request('GET', '/admin/products/business-cards/catalog', undefined, { cookie: admin })).body;
    const elite = before.designServices.find((t: any) => t.code === 'elite');

    expect((await request('PATCH', '/admin/products/business-cards/design-services/elite', { priceCents: 12_345 }, { cookie: admin })).status).toBe(204);
    const offered = (await request('GET', '/products/business-cards/design-services')).body.tiers;
    expect(offered.find((t: any) => t.code === 'elite').priceCents).toBe(12_345);
    expect((await request('PATCH', '/admin/products/business-cards/design-services/elite', { isActive: false }, { cookie: admin })).status).toBe(204);
    expect((await request('GET', '/products/business-cards/design-services')).body.tiers.map((t: any) => t.code)).not.toContain('elite');
    expect((await request('PATCH', '/admin/products/business-cards/design-services/elite', { priceCents: elite.priceCents, isActive: true }, { cookie: admin })).status).toBe(204);
    expect((await request('PATCH', '/admin/products/business-cards/design-services/elite', { designDays: 0 }, { cookie: admin })).status).toBe(400);

    const classic = before.templates.find((t: any) => t.code === 'classic');
    expect((await request('PATCH', '/admin/products/business-cards/templates/classic', { tags: { mood: ['happy'] } }, { cookie: admin })).status).toBe(400);
    expect((await request('PATCH', '/admin/products/business-cards/templates/classic', { tags: { style: ['bold'] } }, { cookie: admin })).status).toBe(204);
    const tagged = (await request('GET', '/products/business-cards/templates')).body.templates.find((t: any) => t.code === 'classic');
    expect(tagged.tags).toEqual({ style: ['bold'] });
    expect((await request('PATCH', '/admin/products/business-cards/templates/classic', { tags: classic.tags }, { cookie: admin })).status).toBe(204);

    // Saving the filters unchanged keeps every template's tags.
    expect((await request('PUT', '/admin/products/business-cards/template-filters', { facets: before.templateFacets }, { cookie: admin })).status).toBe(204);
    const after = (await request('GET', '/admin/products/business-cards/catalog', undefined, { cookie: admin })).body;
    expect(after.templates.map((t: any) => t.tags)).toEqual(before.templates.map((t: any) => t.tags));
    expect(after.templateFacets).toEqual(before.templateFacets);

    const activity = await request('GET', '/admin/audit', undefined, { cookie: admin });
    expect(activity.status).toBe(200);
    expect(JSON.stringify(activity.body)).toContain('catalog.design_service.update');
  });
});
