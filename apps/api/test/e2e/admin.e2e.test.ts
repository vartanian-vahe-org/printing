/**
 * Admin API against a running stack. Needs ADMIN_EMAIL / ADMIN_PASSWORD (the seeded admin from .env):
 *   set -a; . ../../.env; set +a; corepack pnpm test:e2e
 * Every change made here is reverted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const base = process.env.API_BASE_URL ?? 'http://localhost:4000';
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

const admin = `${base}/admin/products/business-cards`;
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
  await call('PATCH', `${admin}/groups/paper/values/16pt`, { label: 'Premium – 16pt Cardstock' });
  await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'turnaround', allowed: null });
  await call('PUT', `${admin}/pricing`, { tiers: [{ quantity: 500, basePriceCents: 2499 }] });
  await call('PATCH', `${admin}/templates/minimal`, { isActive: true });
  await call('PUT', `${admin}/rules`, { whenGroup: 'paper', whenValue: '16pt', targetGroup: 'turnaround', allowed: null });
  await call('DELETE', `${admin}/design-services/e2e_pkg`);
  for (const [group, value] of [['paper', 'e2e_paper'], ['turnaround', 'e2e_rush'], ['size', 'e2e_size']]) {
    await call('DELETE', `${admin}/groups/${group}/values/${value}`);
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
    expect(res.body.groups.map((g: any) => g.code)).toEqual(['size', 'paper', 'coating', 'printed_side', 'corners', 'turnaround']);
    expect(res.body.rules).toHaveLength(7);
    expect(res.body.upcharges).toHaveLength(120);
    expect(res.body.templates).toHaveLength(5);
  });

  it('renames a value and the storefront shows it', async () => {
    expect((await call('PATCH', `${admin}/groups/paper/values/16pt`, { label: 'Premium 16pt (e2e)' })).status).toBe(204);
    const paper = (await storefront()).catalog.groups.find((g: any) => g.code === 'paper');
    expect(paper.values.find((v: any) => v.code === '16pt').label).toBe('Premium 16pt (e2e)');
    await call('PATCH', `${admin}/groups/paper/values/16pt`, { label: 'Premium – 16pt Cardstock' });
  });

  it('refuses to hide the default value', async () => {
    const res = await call('PATCH', `${admin}/groups/paper/values/14pt`, { isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/default option must be active/);
  });

  it('validates attributes per group', async () => {
    const res = await call('PATCH', `${admin}/groups/coating/values/uv_both`, { attributes: { front: 'chrome', back: 'uv', laminated: false } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid attributes');
  });

  it('adds and removes a rule; the storefront follows', async () => {
    const rule = { whenGroup: 'paper', whenValue: '14pt', targetGroup: 'turnaround' };
    expect((await call('PUT', `${admin}/rules`, { ...rule, allowed: ['5d', '3d', '2d'] })).status).toBe(204);
    let rules = (await storefront()).catalog.rules;
    expect(rules.find((r: any) => r.whenValue === '14pt' && r.targetGroup === 'turnaround').allowed).toEqual(['5d', '3d', '2d']);

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

  it('updates a base price; quotes follow', async () => {
    expect((await call('PUT', `${admin}/pricing`, { tiers: [{ quantity: 500, basePriceCents: 2999 }] })).status).toBe(204);
    const selection = { size: 'std_3_5x2', paper: '14pt', coating: 'matte_both', printed_side: 'front_back', corners: 'square', turnaround: '3d' };
    const quote = await call('POST', `${base}/quotes`, { productCode: 'business-cards', selection, quantity: 500 }, false);
    expect(quote.body.totalCents).toBe(2999 + 1449);
    await call('PUT', `${admin}/pricing`, { tiers: [{ quantity: 500, basePriceCents: 2499 }] });
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

describe('admin catalog: adding and deleting options', () => {
  const selection = { size: 'std_3_5x2', paper: '16pt', coating: 'matte_both', printed_side: 'front_back', corners: 'square', turnaround: '3d' };
  const price = async (paper: string) =>
    (await call('POST', `${base}/quotes`, { productCode: 'business-cards', selection: { ...selection, paper }, quantity: 500 }, false)).body.totalCents;

  it('adds an option that starts with the prices and rules of another, then deletes it', async () => {
    const created = await call('POST', `${admin}/groups/paper/values`, {
      code: 'e2e_paper',
      label: 'E2E Paper',
      attributes: { thickness_pt: 18, tier: 'premium' },
      copyFrom: '16pt',
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ code: 'e2e_paper' });

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
  });

  it('makes a code from the label and refuses a taken one', async () => {
    const body = { label: 'Rush 1 Hour!', attributes: { business_days: 1 } };
    const first = await call('POST', `${admin}/groups/turnaround/values`, { ...body, code: 'e2e_rush' });
    expect(first.status).toBe(201);
    const auto = await call('POST', `${admin}/groups/turnaround/values`, body);
    expect(auto.body).toEqual({ code: 'rush_1_hour' });
    expect((await call('DELETE', `${admin}/groups/turnaround/values/rush_1_hour`)).status).toBe(204);

    const taken = await call('POST', `${admin}/groups/turnaround/values`, { ...body, code: 'e2e_rush' });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toMatch(/already exists/);
  });

  it('validates the details of a new option', async () => {
    const res = await call('POST', `${admin}/groups/turnaround/values`, { label: 'Bad', attributes: { business_days: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid attributes');
  });

  it('refuses to delete the default, or the only option a rule allows', async () => {
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
  });

  it('offers every template in a new size and takes it away on delete', async () => {
    const templates = async () => (await call('GET', `${base}/products/business-cards/templates`, undefined, false)).body.templates;
    const attributes = { trim_w_in: 3, trim_h_in: 2, bleed_in: 0.125, safe_in: 0.125, price_multiplier: 1 };
    expect((await call('POST', `${admin}/groups/size/values`, { code: 'e2e_size', label: 'E2E 3" x 2"', attributes })).status).toBe(201);
    expect((await templates()).every((t: any) => t.supportedSizeCodes.includes('e2e_size'))).toBe(true);

    expect((await call('DELETE', `${admin}/groups/size/values/e2e_size`)).status).toBe(204);
    expect((await templates()).some((t: any) => t.supportedSizeCodes.includes('e2e_size'))).toBe(false);
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
    expect(res.body.products).toContainEqual({ code: 'business-cards', name: expect.any(String), isActive: true });
    expect((await call('GET', `${base}/admin/products`, undefined, false)).status).toBe(401);
    expect((await call('GET', `${admin}/catalog`)).body.product).toEqual({ code: 'business-cards', name: expect.any(String) });
  });

  it('adds a package to one product, then deletes it', async () => {
    const body = { code: 'e2e_pkg', name: 'E2E Rush', description: null, priceCents: 1500, features: ['1 concept'], designDays: 1, revisions: 0 };
    const created = await call('POST', `${admin}/design-services`, body);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ code: 'e2e_pkg' });
    const tiers = await offered();
    expect(tiers.at(-1)).toMatchObject({ code: 'e2e_pkg', name: 'E2E Rush', priceCents: 1500, revisions: 0 });

    const taken = await call('POST', `${admin}/design-services`, body);
    expect(taken.status).toBe(400);
    expect(taken.body.message).toMatch(/already exists/);

    expect((await call('DELETE', `${admin}/design-services/e2e_pkg`)).status).toBe(204);
    expect((await offered()).map((t: any) => t.code)).not.toContain('e2e_pkg');
    expect((await call('DELETE', `${admin}/design-services/e2e_pkg`)).status).toBe(404);
  });

  it('validates a new package', async () => {
    const res = await call('POST', `${admin}/design-services`, { name: 'Bad', description: null, priceCents: -1, features: [], designDays: 0, revisions: null });
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
