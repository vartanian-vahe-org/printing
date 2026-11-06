/**
 * Admin API against a running stack. Needs ADMIN_EMAIL / ADMIN_PASSWORD (the seeded admin from .env):
 *   set -a; . ../../.env; set +a; corepack pnpm test:e2e
 * Every change made here is reverted.
 */
import { cmyk, PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { address, checkArtwork, testHeaders, uniqueEmail, uploadArtwork } from './helpers.js';

const base = process.env.API_BASE_URL ?? 'http://localhost:4000';
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

const admin = `${base}/admin/products/business-cards`;
const library = `${base}/admin/options/groups`;
const defaultSelection = { size: 'std_3_5x2', paper: '14pt', coating: 'matte_both', printed_side: 'front_back', corners: 'square', turnaround: 'standard' };
const defaultCore = { size: 'std_3_5x2', paper: '14pt', printedSide: 'front_back' };
const paper16 = { ...defaultCore, paper: '16pt' };
let cookie = '';

async function call(method: string, url: string, body?: unknown, withCookie = true) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(withCookie && cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as any) : null };
}

async function storefront() {
  return (await call('GET', `${base}/products/business-cards/configurator`, undefined, false)).body;
}

beforeAll(async () => {
  const res = await call('POST', `${base}/admin/auth/login`, { email, password }, false);
  expect(res.status).toBe(200);
  cookie = res.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  // Safety net in case an assertion failed mid-test.
  await call('PATCH', `${library}/paper/values/16pt`, { label: 'Premium – 16pt Cardstock' });
  await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'turnaround', allowed: null });
  await call('PUT', `${admin}/pricing`, { corePrices: [{ ...defaultCore, quantity: 500, priceCents: 3948 }, { ...paper16, quantity: 500, priceCents: 4573 }, { ...paper16, quantity: 250, priceCents: 3658 }], addons: [{ group: 'corners', value: 'rounded_quarter', percent: 30 }] });
  await call('PATCH', `${admin}/templates/minimal`, { isActive: true });
  await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'turnaround', allowed: null });
  await call('DELETE', `${base}/admin/options/design-services/e2e_pkg`);
  for (const [group, value] of [['paper', 'e2e_paper'], ['turnaround', 'e2e_rush'], ['turnaround', 'e2e_speed'], ['size', 'e2e_size']]) {
    await call('DELETE', `${admin}/groups/${group}/values/${value}`);
    await call('DELETE', `${library}/${group}/values/${value}`);
  }
  await call('POST', `${base}/admin/auth/logout`);
});

describe('admin auth', () => {
  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const res = await call('POST', `${base}/admin/auth/login`, { email, password }, false);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/admin_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await call('POST', `${base}/admin/auth/login`, { email, password: 'definitely-wrong' }, false);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Email or password is incorrect');
  });

  it('returns the signed-in user', async () => {
    const res = await call('GET', `${base}/admin/auth/me`);
    expect(res.body.user).toMatchObject({ email, role: 'owner' });
  });

  it('protects admin endpoints', async () => {
    expect((await call('GET', `${admin}/catalog`, undefined, false)).status).toBe(401);
    const forged = await fetch(`${admin}/catalog`, { headers: { cookie: 'admin_session=forged-token' } });
    expect(forged.status).toBe(401);
  });
});

describe('admin catalog', () => {
  it('returns everything, including hidden values and rules', async () => {
    const res = await call('GET', `${admin}/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: any) => g.code)).toEqual(['size', 'paper', 'printed_side', 'coating', 'corners', 'turnaround']);
    expect(res.body.rules).toHaveLength(7);
    expect(res.body.corePrices).toHaveLength(216);
    expect(res.body.turnarounds).toHaveLength(31);
    expect(res.body.templates).toHaveLength(5);
  });

  it('renames a value and the storefront shows it', async () => {
    expect((await call('PATCH', `${library}/paper/values/16pt`, { label: 'Premium 16pt (e2e)' })).status).toBe(204);
    const paper = (await storefront()).catalog.groups.find((g: any) => g.code === 'paper');
    expect(paper.values.find((v: any) => v.code === '16pt').label).toBe('Premium 16pt (e2e)');
    await call('PATCH', `${library}/paper/values/16pt`, { label: 'Premium – 16pt Cardstock' });
  });

  it('refuses to hide the default value', async () => {
    const res = await call('PATCH', `${admin}/groups/paper/values/14pt`, { isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/default option must be active/);
  });

  it('validates attributes per group', async () => {
    const res = await call('PATCH', `${library}/coating/values/uv_both`, { attributes: { front: 'chrome', back: 'uv', laminated: false } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid attributes');
  });

  it('adds and removes a rule; the storefront follows', async () => {
    const rule = { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'turnaround' };
    expect((await call('PUT', `${admin}/rules`, { ...rule, allowed: ['economy', 'standard', 'express'] })).status).toBe(204);
    let rules = (await storefront()).catalog.rules;
    expect(rules.find((r: any) => r.whenValue === '14pt' && r.targetGroup === 'turnaround').allowed).toEqual(['economy', 'standard', 'express']);

    expect((await call('PUT', `${admin}/rules`, { ...rule, allowed: null })).status).toBe(204);
    rules = (await storefront()).catalog.rules;
    expect(rules.find((r: any) => r.whenValue === '14pt' && r.targetGroup === 'turnaround')).toBeUndefined();
  });

  it('refuses a rule that allows nothing', async () => {
    const res = await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'coating', allowed: [] });
    expect(res.status).toBe(400);
    // The existing rule is untouched (the change was rolled back).
    const rules = (await storefront()).catalog.rules;
    expect(rules.find((r: any) => r.whenValue === '14pt' && r.targetGroup === 'coating').allowed).toHaveLength(6);
  });

  it('sets the price of a combination; quotes follow', async () => {
    const quote = (paper: string, corners = 'square', quantity = 500) =>
      call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: { ...defaultSelection, paper, corners, coating: 'matte_both' }, quantity }, false);
    expect((await call('PUT', `${admin}/pricing`, { corePrices: [{ ...paper16, quantity: 500, priceCents: 2660 }] })).status).toBe(204);
    expect((await quote('16pt')).body.totalCents).toBe(2660);
    expect((await quote('14pt')).body.totalCents).toBe(3948);

    expect((await call('PUT', `${admin}/pricing`, { addons: [{ group: 'corners', value: 'rounded_quarter', percent: 50 }] })).status).toBe(204);
    expect((await quote('16pt', 'rounded_quarter')).body.totalCents).toBe(3990);
    await call('PUT', `${admin}/pricing`, { corePrices: [{ ...paper16, quantity: 500, priceCents: 4573 }], addons: [{ group: 'corners', value: 'rounded_quarter', percent: 30 }] });
  });

  it('takes a combination off sale at one quantity', async () => {
    expect((await call('PUT', `${admin}/pricing`, { corePrices: [{ ...paper16, quantity: 250, priceCents: null }] })).status).toBe(204);
    const res = await call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: { ...defaultSelection, paper: '16pt' }, quantity: 250 }, false);
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual(['Quantity 250 is not available with these options']);
    expect((await storefront()).catalog.corePrices).toHaveLength(215);
    await call('PUT', `${admin}/pricing`, { corePrices: [{ ...paper16, quantity: 250, priceCents: 3658 }] });
  });

  it('refuses to leave the default options without a price', async () => {
    const res = await call('PUT', `${admin}/pricing`, { corePrices: [{ ...defaultCore, quantity: 500, priceCents: null }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/default options need a price/);
    expect((await storefront()).catalog.corePrices).toHaveLength(216);
  });

  it('refuses a percent on a core option', async () => {
    const res = await call('PUT', `${admin}/pricing`, { addons: [{ group: 'paper', value: '16pt', percent: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/set prices/);
  });

  it('refuses to hide the default quantity tier', async () => {
    const res = await call('PUT', `${admin}/pricing`, { tiers: [{ quantity: 500, isActive: false }] });
    expect(res.status).toBe(400);
  });

  it('hides and shows a template', async () => {
    await call('PATCH', `${admin}/templates/minimal`, { isActive: false });
    let codes = (await call('GET', `${base}/products/business-cards/templates`, undefined, false)).body.templates.map((t: any) => t.code);
    expect(codes).not.toContain('minimal');
    await call('PATCH', `${admin}/templates/minimal`, { isActive: true });
    codes = (await call('GET', `${base}/products/business-cards/templates`, undefined, false)).body.templates.map((t: any) => t.code);
    expect(codes).toContain('minimal');
  });
});

describe('admin catalog: quantities', () => {
  const quantities = async () => (await call('GET', `${admin}/catalog`)).body.quantityTiers.map((t: any) => t.quantity);
  const quote = (quantity: number) =>
    call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: defaultSelection, quantity }, false);

  afterAll(async () => {
    for (const quantity of [600, 700, 12000]) {
      await call('DELETE', `${admin}/quantities/${quantity}`);
      await call('DELETE', `${base}/admin/options/quantities/${quantity}`);
    }
  });

  it('adds a quantity in order, with the closest turnaround and no price', async () => {
    expect((await call('POST', `${admin}/quantities`, { quantity: 600 })).status).toBe(204);
    expect(await quantities()).toEqual([50, 100, 250, 500, 600, 1000, 2500, 5000, 10000]);

    const { turnarounds, corePrices } = (await call('GET', `${admin}/catalog`)).body;
    const at = (quantity: number) => turnarounds.filter((c: any) => c.quantity === quantity).map(({ quantity: _q, ...rest }: any) => rest);
    expect(at(600)).toEqual(at(500));
    expect(corePrices.filter((p: any) => p.quantity === 600)).toEqual([]);
    expect((await quote(600)).status).toBe(400);
  });

  it('sells the quantity once it has a price', async () => {
    await call('PUT', `${admin}/pricing`, { corePrices: [{ ...defaultCore, quantity: 600, priceCents: 4500 }] });
    const res = await quote(600);
    expect(res.status).toBe(200);
    expect(res.body.corePriceCents).toBe(4500);
  });

  it('changes the number and keeps its price and turnaround', async () => {
    expect((await call('PATCH', `${admin}/quantities/600`, { quantity: 12000 })).status).toBe(204);
    expect((await quantities()).slice(-2)).toEqual([10000, 12000]);
    expect((await quote(12000)).body.corePriceCents).toBe(4500);
    expect((await quote(600)).status).toBe(400);
  });

  it('refuses a quantity that already exists', async () => {
    const added = await call('POST', `${admin}/quantities`, { quantity: 500 });
    expect(added.status).toBe(400);
    expect(added.body.message).toMatch(/500 already exists/);
    expect((await call('PATCH', `${admin}/quantities/12000`, { quantity: 500 })).status).toBe(400);
    expect((await call('POST', `${admin}/quantities`, { quantity: 0 })).status).toBe(400);
  });

  it('refuses a default quantity with no price', async () => {
    await call('POST', `${admin}/quantities`, { quantity: 700 });
    const res = await call('PUT', `${admin}/pricing`, { tiers: [{ quantity: 700, isDefault: true }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/need a price at the default quantity/);
  });

  it('deletes a quantity, but not the default one', async () => {
    const res = await call('DELETE', `${admin}/quantities/500`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/default quantity/);

    expect((await call('DELETE', `${admin}/quantities/12000`)).status).toBe(204);
    expect((await call('DELETE', `${admin}/quantities/700`)).status).toBe(204);
    expect(await quantities()).toEqual([50, 100, 250, 500, 1000, 2500, 5000, 10000]);
    expect((await quote(12000)).status).toBe(400);
    expect((await call('DELETE', `${admin}/quantities/12000`)).status).toBe(404);
  });
});

describe('admin products', () => {
  const copy = `${base}/admin/products/e2e-premium`;
  const publicList = async () => (await call('GET', `${base}/products`, undefined, false)).body.products.map((p: any) => p.code);
  const quote = (productCode: string) => call('POST', `${base}/quotes`, { productCode, selection: defaultSelection, quantity: 500 }, false);

  afterAll(async () => {
    await call('PATCH', admin, { isActive: true });
    await call('DELETE', copy);
    await call('DELETE', `${base}/admin/products/e2e-flyers`);
    await call('DELETE', `${admin}/groups/e2e_folding/values/no_fold`);
    await call('DELETE', `${library}/e2e_folding`);
    for (const [group, value] of [['size', 'e2e_letter'], ['paper', 'e2e_100lb'], ['printed_side', 'e2e_front']]) await call('DELETE', `${library}/${group}/values/${value}`);
  });

  it('copies a whole product and keeps it hidden', async () => {
    const res = await call('POST', `${base}/admin/products`, { name: 'E2E Premium', code: 'e2e-premium', description: 'Thick cards', copyFrom: 'business-cards' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('e2e-premium');

    const [source, target] = [(await call('GET', `${admin}/catalog`)).body, (await call('GET', `${copy}/catalog`)).body];
    expect(target.product).toEqual({ code: 'e2e-premium', name: 'E2E Premium' });
    const shape = (c: any) => ({
      groups: c.groups.map((g: any) => ({ ...g, values: g.values.map(({ updatedAt: _u, ...v }: any) => v) })),
      rules: c.rules,
      tiers: c.quantityTiers.map(({ id: _i, productId: _p, createdAt: _c, updatedAt: _u, createdBy: _b, updatedBy: _d, ...t }: any) => t),
      corePrices: [...c.corePrices].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      turnarounds: [...c.turnarounds].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      templates: c.templates.map((t: any) => t.code),
      facets: c.templateFacets.map((f: any) => f.code),
      designServices: c.designServices.map((d: any) => d.code),
    });
    expect(shape(target)).toEqual(shape(source));

    expect(await publicList()).not.toContain('e2e-premium');
    expect((await call('GET', `${base}/products/e2e-premium/configurator`, undefined, false)).status).toBe(404);
  });

  it('edits a hidden product without touching the one it came from', async () => {
    expect((await call('PUT', `${copy}/pricing`, { corePrices: [{ ...defaultCore, quantity: 500, priceCents: 5999 }] })).status).toBe(204);
    expect((await call('DELETE', `${copy}/groups/paper/values/16pt`)).status).toBe(204);
    const source = (await call('GET', `${admin}/catalog`)).body;
    expect(source.corePrices.find((p: any) => p.size === defaultCore.size && p.paper === '14pt' && p.printedSide === 'front_back' && p.quantity === 500).priceCents).toBe(3948);
    expect(source.groups.find((g: any) => g.code === 'paper').values.map((v: any) => v.code)).toContain('16pt');
  });

  it('shows the product with its own URL, text and prices', async () => {
    const seo = { seoTitle: 'Premium Cards', seoDescription: 'Thick premium cards' };
    expect((await call('PATCH', copy, { isActive: true, ...seo })).status).toBe(204);
    const products = (await call('GET', `${base}/products`, undefined, false)).body.products;
    expect(products.find((p: any) => p.code === 'e2e-premium')).toEqual({ code: 'e2e-premium', name: 'E2E Premium', description: 'Thick cards', ...seo });
    expect((await quote('e2e-premium')).body.corePriceCents).toBe(5999);
    expect((await quote('business-cards')).body.corePriceCents).toBe(3948);
  });

  it('a cart holding a hidden product asks the customer to choose again', async () => {
    const design = { mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } };
    const added = await call('POST', `${base}/cart/items`, { productCode: 'e2e-premium', configuration: { selection: defaultSelection, quantity: 500 }, design }, false);
    expect(added.status).toBe(201);
    const cart = added.headers.get('set-cookie')!.split(';')[0]!;

    await call('PATCH', copy, { isActive: false });
    const view = (await (await fetch(`${base}/cart`, { headers: { cookie: cart } })).json()) as any;
    expect(view.hasUnavailableItems).toBe(true);
    expect(view.items[0].totalCents).toBeNull();
    await call('PATCH', copy, { isActive: true });
  });

  it('refuses a URL that is taken, reserved or malformed', async () => {
    const add = (code: string) => call('POST', `${base}/admin/products`, { name: 'X', code, copyFrom: 'business-cards' });
    expect((await add('e2e-premium')).body.message).toMatch(/already used/);
    expect((await add('checkout')).body.message).toMatch(/already a page/);
    expect((await add('Bad URL')).status).toBe(400);
    expect((await call('POST', `${base}/admin/products`, { name: 'X', copyFrom: 'nope' })).status).toBe(404);
  });

  it('makes the URL from the name, and deletes the product', async () => {
    const res = await call('POST', `${base}/admin/products`, { name: 'E2E Silk Cards!', copyFrom: 'business-cards' });
    expect(res.body.code).toBe('e2e-silk-cards');
    expect((await call('DELETE', `${base}/admin/products/e2e-silk-cards`)).status).toBe(204);
    expect((await call('GET', `${base}/admin/products/e2e-silk-cards/catalog`)).status).toBe(404);
  });

  it('builds a blank product from nothing and shows it once it can be sold', async () => {
    const flyers = `${base}/admin/products/e2e-flyers`;
    const issue = async () => (await call('GET', `${base}/admin/products`)).body.products.find((p: any) => p.code === 'e2e-flyers').setupIssue;
    const created = await call('POST', `${base}/admin/products`, { name: 'E2E Flyers' });
    expect(created.body.code).toBe('e2e-flyers');
    const blank = (await call('GET', `${flyers}/catalog`)).body;
    expect(blank.groups.map((g: any) => [g.code, g.values.length])).toEqual([['size', 0], ['paper', 0], ['printed_side', 0], ['turnaround', 0]]);
    expect(await issue()).toMatch(/Add at least one option to: Size, Paper, Printed Side, Turnaround/);
    const early = await call('PATCH', flyers, { isActive: true });
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/Add at least one option/);

    const add = (group: string, code: string, label: string, attributes: Record<string, unknown>) => call('POST', `${library}/${group}/values`, { code, label, attributes });
    const use = (group: string, value: string) => call('POST', `${flyers}/groups/${group}/values`, { value });
    expect((await add('size', 'e2e_letter', 'Letter', { trim_w_in: 8.5, trim_h_in: 11, bleed_in: 0.125, safe_in: 0.125 })).status).toBe(201);
    expect((await add('size', 'e2e_too_big', 'Too big', { trim_w_in: 40, trim_h_in: 11, bleed_in: 0.125, safe_in: 0.125 })).status).toBe(400);
    expect((await add('paper', 'e2e_100lb', '100lb Text', { thickness_pt: 4 })).status).toBe(201);
    expect((await add('printed_side', 'e2e_front', 'Front only', { back: 'blank' })).status).toBe(201);
    expect((await use('size', 'e2e_letter')).status).toBe(204);
    expect((await use('size', 'e2e_letter')).body.message).toMatch(/already uses/);
    expect((await use('paper', 'e2e_100lb')).status).toBe(204);
    expect((await use('printed_side', 'e2e_front')).status).toBe(204);
    // A speed from the library, with the days and percent of this product.
    expect((await use('turnaround', 'standard')).status).toBe(204);
    expect((await call('POST', `${flyers}/quantities`, { quantity: 250 })).status).toBe(204);
    const filled = (await call('GET', `${flyers}/catalog`)).body;
    expect(filled.groups.every((g: any) => g.values[0].isDefault)).toBe(true);
    expect(filled.quantityTiers[0].isDefault).toBe(true);

    expect(await issue()).toMatch(/Enter prices/);
    const cell = { size: 'e2e_letter', paper: 'e2e_100lb', printedSide: 'e2e_front', quantity: 250, priceCents: 8900 };
    expect((await call('PUT', `${flyers}/pricing`, { corePrices: [cell] })).status).toBe(204);
    // The speed ticked before the quantity applies with its library days and percent, with nothing else to set.
    expect(await issue()).toBeNull();
    expect((await call('GET', `${flyers}/catalog`)).body.turnarounds).toEqual([expect.objectContaining({ value: 'standard', quantity: 250, percent: 0 })]);

    expect((await call('PATCH', flyers, { isActive: true })).status).toBe(204);
    const page = (await call('GET', `${base}/products/e2e-flyers/configurator`, undefined, false)).body;
    expect(page.catalog.product).toMatchObject({ unitName: 'e2e flyer', unitNamePlural: 'e2e flyers' });
    expect(page.defaults.quantity).toBe(250);
    const priced = await call('POST', `${base}/quotes`, { productCode: 'e2e-flyers', selection: page.defaults.selection, quantity: 250 }, false);
    expect(priced.body.totalCents).toBe(8900);

    // A customer orders it with their own file, sized for this product and not for a card.
    const doc = await PDFDocument.create();
    doc.addPage([630, 810]).drawRectangle({ x: 0, y: 0, width: 630, height: 810, color: cmyk(0, 0, 0, 1) });
    const key = await uploadArtwork(await doc.save(), 'flyer.pdf');
    const checked = await checkArtwork(key, { geometry: { widthIn: 8.5, heightIn: 11, bleedIn: 0.125, safeIn: 0.125 }, side: 'front', maxPages: 1 });
    expect(checked.issues.filter((i) => i.level === 'error')).toEqual([]);
    let cart = '';
    const shop = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...testHeaders, ...(cart ? { cookie: cart } : {}) },
        body: JSON.stringify(body),
      });
      cart = res.headers.get('set-cookie')?.split(';')[0] ?? cart;
      return { status: res.status, body: (await res.json()) as any };
    };
    const added = await shop('/cart/items', {
      productCode: 'e2e-flyers',
      configuration: { selection: page.defaults.selection, quantity: 250 },
      design: { mode: 'upload', front: { key: checked.outputKey, fileName: 'flyer.pdf', pageCount: 1 }, proof: 'send' },
    });
    expect(added.status).toBe(201);
    expect(added.body.items[0].totalCents).toBe(8900);
    const totals = (await shop('/checkout/quote', { address: { state: 'CA', zip: '90012' } })).body.totals;
    const order = await shop('/checkout/orders', { email: uniqueEmail(), shippingAddress: address, shippingMethodCode: 'standard', expectedTotalCents: totals.totalCents });
    expect(order.status).toBe(201);
    expect(order.body.number).toBeGreaterThan(0);

    // Live now: the checks are back.
    expect((await call('PUT', `${flyers}/pricing`, { corePrices: [{ ...cell, priceCents: null }] })).status).toBe(400);
    await call('PATCH', flyers, { isActive: false });

    // Shared: another product's speed table is untouched, and an option in use stays in the library.
    expect((await call('GET', `${admin}/catalog`)).body.turnarounds.filter((c: any) => c.value === 'standard' && c.quantity === 500)).toEqual([expect.objectContaining({ businessDays: 3 })]);
    const inUse = await call('DELETE', `${library}/size/values/e2e_letter`);
    expect(inUse.status).toBe(400);
    expect(inUse.body.message).toMatch(/Used by E2E Flyers/);
    expect((await call('DELETE', flyers)).status).toBe(204);
    expect((await call('GET', `${base}/admin/options`)).body.groups.find((g: any) => g.code === 'size').values.find((v: any) => v.code === 'e2e_letter').usedBy).toEqual([]);
    expect((await call('DELETE', `${library}/size/values/e2e_letter`)).status).toBe(204);
  });

  it('saves what a product offers in a group in one go', async () => {
    const put = (body: unknown) => call('PUT', `${copy}/groups/corners/values`, body);
    const corners = async () => (await call('GET', `${copy}/catalog`)).body.groups.find((g: any) => g.code === 'corners').values;
    const before = await corners();
    expect(before.map((v: any) => v.code)).toEqual(['square', 'rounded_quarter']);
    const percent = before.find((v: any) => v.code === 'rounded_quarter').addonPercent;

    expect((await put({ values: [{ code: 'square' }, { code: 'rounded_quarter', isActive: false }], default: 'rounded_quarter' })).body.message).toMatch(/default option must be active/);
    expect((await put({ values: [{ code: 'square' }], default: 'rounded_quarter' })).body.message).toMatch(/default must be one/);
    expect((await put({ values: [{ code: 'nope' }] })).status).toBe(404);

    expect((await put({ values: [{ code: 'square', isActive: true }, { code: 'rounded_quarter', isActive: false, addonPercent: 12 }] })).status).toBe(204);
    expect((await corners()).find((v: any) => v.code === 'rounded_quarter')).toMatchObject({ isActive: false, addonPercent: 12, isDefault: false });
    expect((await put({ values: [{ code: 'square' }] })).status).toBe(204);
    expect((await corners()).map((v: any) => v.code)).toEqual(['square']);
    expect((await put({ values: [{ code: 'rounded_quarter', isActive: true, addonPercent: percent }, { code: 'square' }], default: 'square' })).status).toBe(204);
    expect((await corners()).map((v: any) => [v.code, v.isDefault, v.isActive])).toEqual([['square', true, true], ['rounded_quarter', false, true]]);
  });

  it('sets speeds in the library; a product follows them unless it changed a cell', async () => {
    const speed = { code: 'e2e_fast', label: 'E2E Fast', attributes: { min_days: 2, max_days: 3, percent: 10 } };
    expect((await call('POST', `${library}/turnaround/values`, { ...speed, attributes: { min_days: 4, max_days: 3, percent: 10 } })).status).toBe(400);
    expect((await call('POST', `${library}/turnaround/values`, speed)).status).toBe(201);
    expect((await call('POST', `${copy}/groups/turnaround/values`, { value: 'e2e_fast' })).status).toBe(204);
    const cells = async () => (await call('GET', `${copy}/catalog`)).body.turnarounds;
    const fast = async () => (await cells()).filter((c: any) => c.value === 'e2e_fast');
    const tiers = (await call('GET', `${copy}/catalog`)).body.quantityTiers;
    expect((await fast()).map((c: any) => [c.minBusinessDays, c.businessDays, c.percent])).toEqual(tiers.map(() => [2, 3, 10]));

    const all = await cells();
    const custom = all.map((c: any) => (c.value === 'e2e_fast' && c.quantity === 500 ? { ...c, businessDays: 9 } : c));
    expect((await call('PUT', `${copy}/turnarounds`, { cells: custom })).status).toBe(204);
    expect((await call('PATCH', `${library}/turnaround/values/e2e_fast`, { attributes: { min_days: 1, max_days: 2, percent: 5 } })).status).toBe(204);
    const after = await fast();
    expect(after.find((c: any) => c.quantity === 500)).toMatchObject({ minBusinessDays: 2, businessDays: 9, percent: 10 });
    expect(after.find((c: any) => c.quantity === 100)).toMatchObject({ minBusinessDays: 1, businessDays: 2, percent: 5 });

    expect((await call('DELETE', `${copy}/groups/turnaround/values/e2e_fast`)).status).toBe(204);
    expect((await call('DELETE', `${library}/turnaround/values/e2e_fast`)).status).toBe(204);
  });

  it('shares quantities through the library', async () => {
    const options = `${base}/admin/options`;
    const quantities = async () => (await call('GET', options)).body.quantities;
    const tiers = async () => (await call('GET', `${copy}/catalog`)).body.quantityTiers.map((t: any) => t.quantity);
    expect((await call('POST', `${options}/quantities`, { quantity: 777 })).status).toBe(204);
    expect((await call('POST', `${options}/quantities`, { quantity: 777 })).status).toBe(400);
    const before = await tiers();
    expect((await quantities()).find((q: any) => q.quantity === 777).usedBy).toEqual([]);

    const put = (body: unknown) => call('PUT', `${copy}/quantities`, body);
    const all = before.map((quantity: number) => ({ quantity }));
    expect((await put({ quantities: [...all, { quantity: 778 }] })).body.message).toMatch(/option library/);
    expect((await put({ quantities: [...all, { quantity: 777 }] })).status).toBe(204);
    expect(await tiers()).toContain(777);
    expect((await quantities()).find((q: any) => q.quantity === 777).usedBy).toEqual(['E2E Premium']);

    const inUse = await call('DELETE', `${options}/quantities/777`);
    expect(inUse.status).toBe(400);
    expect(inUse.body.message).toMatch(/Used by E2E Premium/);

    // A new number reaches the product, with its price.
    const cell = { ...defaultCore, quantity: 777, priceCents: 7000 };
    expect((await call('PUT', `${copy}/pricing`, { corePrices: [cell] })).status).toBe(204);
    expect((await call('PATCH', `${options}/quantities/777`, { quantity: 779 })).status).toBe(204);
    const catalog = (await call('GET', `${copy}/catalog`)).body;
    expect(catalog.quantityTiers.map((t: any) => t.quantity)).toEqual([...before, 779].sort((a, b) => a - b));
    expect(catalog.corePrices.find((p: any) => p.quantity === 779 && p.size === defaultCore.size && p.paper === '14pt' && p.printedSide === 'front_back').priceCents).toBe(7000);

    expect((await put({ quantities: all })).status).toBe(204);
    expect(await tiers()).toEqual(before);
    expect((await call('DELETE', `${options}/quantities/779`)).status).toBe(204);
  });

  it('adds, renames and deletes library groups; the required ones stay', async () => {
    const created = await call('POST', `${library}`, { label: 'E2E Folding', firstOption: 'No fold' });
    expect(created.body.code).toBe('e2e_folding');
    const allGroups = async () => (await call('GET', `${base}/admin/options`)).body.groups;
    const groups = async () => (await call('GET', `${admin}/catalog`)).body.groups;
    expect((await allGroups()).at(-1).code).toBe('turnaround');
    // In the library, but no product offers it yet.
    expect((await groups()).some((g: any) => g.code === 'e2e_folding')).toBe(false);
    expect((await quote('business-cards')).status).toBe(200);

    expect((await call('POST', `${admin}/groups/e2e_folding/values`, { value: 'no_fold' })).status).toBe(204);
    expect((await groups()).find((g: any) => g.code === 'e2e_folding').values).toEqual([expect.objectContaining({ code: 'no_fold', isDefault: true })]);
    const selection = { ...defaultSelection, e2e_folding: 'no_fold' };
    expect((await call('POST', `${base}/quotes`, { productCode: 'business-cards', selection, quantity: 500 }, false)).status).toBe(200);
    expect((await call('POST', `${library}`, { label: 'E2E Folding', firstOption: 'x' })).status).toBe(400);

    expect((await call('PATCH', `${library}/e2e_folding`, { label: 'E2E Fold' })).status).toBe(204);
    expect((await groups()).find((g: any) => g.code === 'e2e_folding').label).toBe('E2E Fold');
    expect((await call('PATCH', `${library}/paper`, { label: 'Stock' })).status).toBe(204);
    expect((await call('PATCH', `${library}/paper`, { label: 'Paper' })).status).toBe(204);

    const required = await call('DELETE', `${library}/size`);
    expect(required.status).toBe(400);
    expect(required.body.message).toMatch(/needed by every product/);
    const used = await call('DELETE', `${library}/e2e_folding`);
    expect(used.status).toBe(400);
    expect(used.body.message).toMatch(/Used by/);
    await call('POST', `${library}/e2e_folding/values`, { code: 'e2e_half', label: 'Half', attributes: {} });
    expect((await call('DELETE', `${library}/e2e_folding/values/e2e_half`)).status).toBe(204);

    // Its last option off the product takes the group off too; a required group stays filled on a live product.
    expect((await call('DELETE', `${admin}/groups/e2e_folding/values/no_fold`)).status).toBe(204);
    expect((await groups()).some((g: any) => g.code === 'e2e_folding')).toBe(false);
    expect((await call('DELETE', `${library}/e2e_folding`)).status).toBe(204);
    expect((await allGroups()).map((g: any) => g.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await quote('business-cards')).status).toBe(200);
  });

  it('keeps at least one product on the storefront', async () => {
    expect((await call('PATCH', admin, { isActive: false })).status).toBe(204);
    expect(await publicList()).not.toContain('business-cards');
    expect((await quote('business-cards')).status).toBe(404);

    const hide = await call('PATCH', copy, { isActive: false });
    expect(hide.status).toBe(400);
    expect(hide.body.message).toMatch(/At least one product/);
    expect((await call('DELETE', copy)).status).toBe(400);

    expect((await call('PATCH', admin, { isActive: true })).status).toBe(204);
    expect((await quote('business-cards')).status).toBe(200);
    expect((await call('DELETE', copy)).status).toBe(204);
    expect(await publicList()).toEqual(['business-cards']);
  });
});

describe('admin catalog: turnaround table', () => {
  const selection = { size: 'std_3_5x2', paper: '14pt', coating: 'matte_both', printed_side: 'front_back', corners: 'square' };
  const quote = (turnaround: string, quantity: number) =>
    call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: { ...selection, turnaround }, quantity }, false);
  let original: { value: string; quantity: number; minBusinessDays: number; businessDays: number; percent: number }[] = [];

  beforeAll(async () => {
    original = (await call('GET', `${admin}/catalog`)).body.turnarounds;
  });
  afterAll(async () => {
    await call('PUT', `${admin}/turnarounds`, { cells: original });
  });

  it('prices turnaround as a percent of the printing price, with days per quantity', async () => {
    const standard = (await quote('standard', 500)).body;
    const rush = (await quote('rush', 500)).body;
    expect(rush.totalCents).toBe(standard.totalCents + Math.round(standard.totalCents * 0.8));
    expect(rush.businessDays).toBe(1);
    expect((await quote('standard', 10000)).body.businessDays).toBe(5);
    expect((await quote('rush', 10000)).status).toBe(400);
  });

  it('replaces the table; the storefront follows', async () => {
    const cells = original
      .filter((c) => !(c.value === 'rush' && c.quantity === 500))
      .map((c) => (c.value === 'express' && c.quantity === 500 ? { ...c, minBusinessDays: 3, businessDays: 3, percent: 12.5 } : c));
    expect((await call('PUT', `${admin}/turnarounds`, { cells })).status).toBe(204);
    expect((await quote('rush', 500)).status).toBe(400);
    const standard = (await quote('standard', 500)).body;
    const express = (await quote('express', 500)).body;
    expect(express.businessDays).toBe(3);
    expect(express.minBusinessDays).toBe(3);
    expect(express.totalCents).toBe(standard.totalCents + Math.round(standard.totalCents * 0.125));
    await call('PUT', `${admin}/turnarounds`, { cells: original });
  });

  it('refuses to leave a quantity with no speed, and unknown speeds', async () => {
    const none = await call('PUT', `${admin}/turnarounds`, { cells: original.filter((c) => c.quantity !== 50) });
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/No turnaround would be offered at quantity 50/);
    expect((await call('GET', `${admin}/catalog`)).body.turnarounds).toHaveLength(original.length);

    const backwards = await call('PUT', `${admin}/turnarounds`, { cells: original.map((c) => ({ ...c, minBusinessDays: c.businessDays + 1 })) });
    expect(backwards.status).toBe(400);
    const unknown = await call('PUT', `${admin}/turnarounds`, { cells: [...original, { value: 'warp', quantity: 50, businessDays: 1, percent: 0 }] });
    expect(unknown.status).toBe(400);
  });

  it('refuses a turnaround percent in the add-ons', async () => {
    const res = await call('PUT', `${admin}/pricing`, { addons: [{ group: 'turnaround', value: 'rush', percent: 10 }] });
    expect(res.status).toBe(400);
  });

  it('a speed copied from another starts with its days and percents', async () => {
    expect((await call('POST', `${library}/turnaround/values`, { code: 'e2e_speed', label: 'E2E Speed', attributes: { min_days: 1, max_days: 1, percent: 0 } })).status).toBe(201);
    expect((await call('POST', `${admin}/groups/turnaround/values`, { value: 'e2e_speed', copyFrom: 'rush' })).status).toBe(204);
    const cells = (await call('GET', `${admin}/catalog`)).body.turnarounds;
    const of = (value: string) => cells.filter((c: any) => c.value === value).map(({ value: _v, ...rest }: any) => rest);
    expect(of('e2e_speed')).toEqual(of('rush'));
    expect((await call('DELETE', `${admin}/groups/turnaround/values/e2e_speed`)).status).toBe(204);
    expect((await call('DELETE', `${library}/turnaround/values/e2e_speed`)).status).toBe(204);
  });
});

describe('admin catalog: adding and deleting options', () => {
  const selection = { size: 'std_3_5x2', paper: '16pt', coating: 'matte_both', printed_side: 'front_back', corners: 'square', turnaround: 'standard' };
  const price = async (paper: string) =>
    (await call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: { ...selection, paper }, quantity: 500 }, false)).body.totalCents;

  it('adds an option that starts with the prices and rules of another, then deletes it', async () => {
    const created = await call('POST', `${library}/paper/values`, { code: 'e2e_paper', label: 'E2E Paper', attributes: { thickness_pt: 18 } });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ code: 'e2e_paper' });
    expect((await call('POST', `${admin}/groups/paper/values`, { value: 'e2e_paper', copyFrom: '16pt' })).status).toBe(204);

    let catalog = (await storefront()).catalog;
    const paper = catalog.groups.find((g: any) => g.code === 'paper');
    expect(paper.values.at(-1)).toMatchObject({ code: 'e2e_paper', label: 'E2E Paper', isDefault: false });
    expect(await price('e2e_paper')).toBe(await price('16pt'));
    const rulesOf = (value: string) =>
      catalog.rules.filter((r: any) => r.whenValue === value).map((r: any) => ({ target: r.targetGroup, allowed: [...r.allowed].sort() }));
    expect(rulesOf('e2e_paper')).toEqual(rulesOf('16pt'));

    expect((await call('DELETE', `${admin}/groups/paper/values/e2e_paper`)).status).toBe(204);
    catalog = (await storefront()).catalog;
    expect(catalog.groups.find((g: any) => g.code === 'paper').values.map((v: any) => v.code)).not.toContain('e2e_paper');
    expect(catalog.rules.filter((r: any) => r.whenValue === 'e2e_paper')).toEqual([]);
    expect((await call('DELETE', `${library}/paper/values/e2e_paper`)).status).toBe(204);
  });

  it('makes a code from the label and refuses a taken one', async () => {
    const body = { label: 'Rush 1 Hour!', attributes: { min_days: 1, max_days: 1, percent: 90 } };
    const first = await call('POST', `${library}/turnaround/values`, { ...body, code: 'e2e_rush' });
    expect(first.status).toBe(201);
    const auto = await call('POST', `${library}/turnaround/values`, body);
    expect(auto.body).toEqual({ code: 'rush_1_hour' });
    expect((await call('DELETE', `${library}/turnaround/values/rush_1_hour`)).status).toBe(204);

    const taken = await call('POST', `${library}/turnaround/values`, { ...body, code: 'e2e_rush' });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toMatch(/already exists/);
  });

  it('validates the details of a new option', async () => {
    const res = await call('POST', `${library}/turnaround/values`, { label: 'Bad', attributes: { business_days: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid attributes');
  });

  it('refuses to remove the default, or the only option a rule allows', async () => {
    expect((await call('POST', `${admin}/groups/turnaround/values`, { value: 'e2e_rush' })).status).toBe(204);
    const def = await call('DELETE', `${admin}/groups/paper/values/14pt`);
    expect(def.status).toBe(400);
    expect(def.body.message).toMatch(/default option/);

    await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'turnaround', allowed: ['e2e_rush'] });
    const only = await call('DELETE', `${admin}/groups/turnaround/values/e2e_rush`);
    expect(only.status).toBe(400);
    expect(only.body.message).toMatch(/only option allowed with Premium/);

    await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'turnaround', allowed: null });
    expect((await call('DELETE', `${admin}/groups/turnaround/values/e2e_rush`)).status).toBe(204);
    expect((await call('DELETE', `${admin}/groups/turnaround/values/e2e_rush`)).status).toBe(404);
    expect((await call('DELETE', `${library}/turnaround/values/e2e_rush`)).status).toBe(204);
  });

  it('offers every template in a new size and takes it away on delete', async () => {
    const templates = async () => (await call('GET', `${base}/products/business-cards/templates`, undefined, false)).body.templates;
    const attributes = { trim_w_in: 3, trim_h_in: 2, bleed_in: 0.125, safe_in: 0.125 };
    expect((await call('POST', `${library}/size/values`, { code: 'e2e_size', label: 'E2E 3" x 2"', attributes })).status).toBe(201);
    expect((await call('POST', `${admin}/groups/size/values`, { value: 'e2e_size' })).status).toBe(204);
    expect((await templates()).every((t: any) => t.supportedSizeCodes.includes('e2e_size'))).toBe(true);

    expect((await call('DELETE', `${admin}/groups/size/values/e2e_size`)).status).toBe(204);
    expect((await templates()).some((t: any) => t.supportedSizeCodes.includes('e2e_size'))).toBe(false);
    expect((await call('DELETE', `${library}/size/values/e2e_size`)).status).toBe(204);
  });

  it('records additions and deletions in the activity log', async () => {
    const actions = (await call('GET', `${base}/admin/audit`)).body.entries.map((e: any) => e.action);
    expect(actions).toContain('catalog.value.create');
    expect(actions).toContain('catalog.value.delete');
  });
});

describe('admin products and design packages', () => {
  const offered = async () => (await call('GET', `${base}/products/business-cards/design-services`, undefined, false)).body.tiers;

  it('lists the products to configure', async () => {
    const res = await call('GET', `${base}/admin/products`);
    expect(res.status).toBe(200);
    expect(res.body.products).toContainEqual(expect.objectContaining({ code: 'business-cards', name: expect.any(String), isActive: true }));
    expect((await call('GET', `${base}/admin/products`, undefined, false)).status).toBe(401);
    expect((await call('GET', `${admin}/catalog`)).body.product).toEqual({ code: 'business-cards', name: expect.any(String) });
  });

  it('shares a package through the library, with a name and price per product', async () => {
    const packages = `${base}/admin/options/design-services`;
    const body = { code: 'e2e_pkg', name: 'E2E Rush', description: null, priceCents: 1500, features: ['1 concept'], designDays: 1, revisions: 0 };
    const created = await call('POST', packages, body);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ code: 'e2e_pkg' });
    expect((await offered()).map((t: any) => t.code)).not.toContain('e2e_pkg');
    const taken = await call('POST', packages, body);
    expect(taken.status).toBe(400);
    expect(taken.body.message).toMatch(/already exists/);

    const current = (await call('GET', `${admin}/catalog`)).body.designServices.map(({ code, displayName, priceCents, isActive }: any) => ({ code, displayName, priceCents, isActive }));
    const put = (services: unknown[]) => call('PUT', `${admin}/design-services`, { services });
    expect((await put([...current, { code: 'e2e_pkg', displayName: 'Card Rush', priceCents: 1900 }])).status).toBe(204);
    expect((await offered()).at(-1)).toMatchObject({ code: 'e2e_pkg', name: 'Card Rush', priceCents: 1900, revisions: 0 });
    const library = (await call('GET', `${base}/admin/options`)).body.designServices.find((d: any) => d.code === 'e2e_pkg');
    expect(library).toMatchObject({ name: 'E2E Rush', priceCents: 1500, usedBy: [expect.any(String)] });

    // Edited in the library for everyone; the product keeps its own name and price.
    expect((await call('PATCH', `${packages}/e2e_pkg`, { name: 'E2E Express', revisions: 2 })).status).toBe(204);
    expect((await offered()).at(-1)).toMatchObject({ name: 'Card Rush', priceCents: 1900, revisions: 2 });

    const used = await call('DELETE', `${packages}/e2e_pkg`);
    expect(used.status).toBe(400);
    expect(used.body.message).toMatch(/Used by/);
    expect((await put([...current, { code: 'e2e_pkg', priceCents: 1900 }])).status).toBe(204);
    expect((await offered()).at(-1).name).toBe('E2E Express');
    expect((await put(current)).status).toBe(204);
    expect((await offered()).map((t: any) => t.code)).not.toContain('e2e_pkg');
    expect((await call('DELETE', `${packages}/e2e_pkg`)).status).toBe(204);
    expect((await call('DELETE', `${packages}/e2e_pkg`)).status).toBe(404);
  });

  it('validates a new package', async () => {
    const res = await call('POST', `${base}/admin/options/design-services`, { name: 'Bad', description: null, priceCents: -1, features: [], designDays: 0, revisions: null });
    expect(res.status).toBe(400);
  });
});

describe('admin logout', () => {
  it('revokes the session', async () => {
    const login = await call('POST', `${base}/admin/auth/login`, { email, password }, false);
    const session = login.headers.get('set-cookie')!.split(';')[0]!;
    await fetch(`${base}/admin/auth/logout`, { method: 'POST', headers: { cookie: session } });
    const me = await fetch(`${base}/admin/auth/me`, { headers: { cookie: session } });
    expect(me.status).toBe(401);
  });
});
