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

describe('admin logout', () => {
  it('revokes the session', async () => {
    const login = await call('POST', `${base}/admin/auth/login`, { email, password }, false);
    const session = login.headers.get('set-cookie')!.split(';')[0]!;
    await fetch(`${base}/admin/auth/logout`, { method: 'POST', headers: { cookie: session } });
    const me = await fetch(`${base}/admin/auth/me`, { headers: { cookie: session } });
    expect(me.status).toBe(401);
  });
});
