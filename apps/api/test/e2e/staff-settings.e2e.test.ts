/**
 * Phase 2 step 11 against a running stack: staff accounts (owner only), what the 'staff' role may
 * do on orders (decision B10), password changes, shop settings and the audit log.
 * Accounts created here are disabled at the end; settings are put back.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base, placeOrder, uniqueEmail, waitForProofs } from './helpers.js';

const ownerEmail = process.env.ADMIN_EMAIL;
const ownerPassword = process.env.ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

/** This run's client IP: the failed sign-ins below must not lock out other test files (5 per IP). */
const clientIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp },
    body: JSON.stringify({ email, password }),
  });
  return res.ok ? res.headers.get('set-cookie')!.split(';')[0]! : null;
}

function as(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };
}

let owner: ReturnType<typeof as>;
const created: string[] = [];
let originalSettings: any;

beforeAll(async () => {
  owner = as((await login(ownerEmail, ownerPassword))!);
  originalSettings = (await owner('GET', '/admin/settings')).body;
});

afterAll(async () => {
  for (const id of created) await owner('PATCH', `/admin/staff/${id}`, { isActive: false });
  if (originalSettings) {
    await owner('PUT', '/admin/settings/store', originalSettings.store);
    await owner('PUT', '/admin/settings/calendar', { cutoffTime: originalSettings.calendar.cutoffTime, workingDays: originalSettings.calendar.workingDays });
  }
});

async function newStaff(role: 'admin' | 'staff') {
  const email = `e2e-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const res = await owner('POST', '/admin/staff', { email, name: `E2E ${role}`, role, password });
  expect(res.status).toBe(201);
  created.push(res.body.id);
  return { id: res.body.id as string, email, password };
}

describe('staff accounts', () => {
  it('only the owner manages accounts; passwords must be long', async () => {
    const admin = await newStaff('admin');
    const asAdmin = as((await login(admin.email, admin.password))!);
    expect((await asAdmin('GET', '/admin/staff')).status).toBe(403);
    expect((await owner('POST', '/admin/staff', { email: uniqueEmail(), name: 'Short', role: 'staff', password: 'short' })).status).toBe(400);
    expect((await owner('POST', '/admin/staff', { email: admin.email.toUpperCase(), name: 'Dup', role: 'staff', password: 'long-enough-password' })).status).toBe(409);
    const list = (await owner('GET', '/admin/staff')).body.staff;
    expect(list.find((s: any) => s.email === admin.email)).toMatchObject({ role: 'admin', isActive: true, lastLoginAt: expect.any(String) });
  });

  it('the staff role prints and ships but cannot take money or cancel', async () => {
    const worker = await newStaff('staff');
    const asStaff = as((await login(worker.email, worker.password))!);
    const order = await placeOrder(uniqueEmail());
    const path = `/admin/orders/${order.number}`;

    expect((await asStaff('GET', path)).status).toBe(200);
    expect((await asStaff('POST', `${path}/payments`, { reference: 'cash' })).status).toBe(403);
    expect((await asStaff('POST', `${path}/cancel`, {})).status).toBe(403);
    expect((await asStaff('POST', `${path}/notes`, { text: 'Paper loaded' })).status).toBe(204);

    await owner('POST', `${path}/payments`, { reference: 'Zelle', notify: false });
    await waitForProofs(order.number, order.accessToken);
    expect((await asStaff('POST', `${path}/items/1/proof/approve`)).status).toBe(403);
    await owner('POST', `${path}/items/1/proof/approve`);
    expect((await asStaff('POST', `${path}/production`)).status).toBe(204);
    expect((await asStaff('POST', `${path}/shipments`, { carrier: 'usps', trackingNumber: '9400100000000000000000', notify: false })).status).toBe(204);
    expect((await asStaff('PUT', '/admin/settings/store', originalSettings.store)).status).toBe(403);
  });

  it('disabling an account or resetting its password signs the person out', async () => {
    const person = await newStaff('staff');
    const cookie = (await login(person.email, person.password))!;
    expect((await as(cookie)('GET', '/admin/auth/me')).status).toBe(200);

    expect((await owner('POST', `/admin/staff/${person.id}/password`, { password: 'a-brand-new-password' })).status).toBe(204);
    expect((await as(cookie)('GET', '/admin/auth/me')).status).toBe(401);
    expect(await login(person.email, person.password)).toBeNull();
    const second = (await login(person.email, 'a-brand-new-password'))!;

    expect((await owner('PATCH', `/admin/staff/${person.id}`, { isActive: false })).status).toBe(204);
    expect((await as(second)('GET', '/admin/auth/me')).status).toBe(401);
    expect(await login(person.email, 'a-brand-new-password')).toBeNull();
  });

  it('people change their own password with the current one', async () => {
    const person = await newStaff('staff');
    const me = as((await login(person.email, person.password))!);
    expect((await me('POST', '/admin/auth/password', { currentPassword: 'wrong', newPassword: 'another-long-password' })).status).toBe(401);
    expect((await me('POST', '/admin/auth/password', { currentPassword: person.password, newPassword: 'another-long-password' })).status).toBe(204);
    expect((await me('GET', '/admin/auth/me')).status).toBe(200);
    expect(await login(person.email, 'another-long-password')).not.toBeNull();
  });

  it('keeps at least one active owner', async () => {
    const me = (await owner('GET', '/admin/staff')).body.staff.find((s: any) => s.email === ownerEmail);
    const owners = (await owner('GET', '/admin/staff')).body.staff.filter((s: any) => s.role === 'owner' && s.isActive);
    if (owners.length === 1) expect((await owner('PATCH', `/admin/staff/${me.id}`, { role: 'admin' })).status).toBe(409);
  });
});

describe('settings and audit log', () => {
  it('updates store settings and the production calendar, with an audit trail', async () => {
    const store = { ...originalSettings.store, storeName: `Print Studio ${randomUUID().slice(0, 4)}` };
    expect((await owner('PUT', '/admin/settings/store', store)).status).toBe(204);
    expect((await owner('GET', '/admin/settings')).body.store.storeName).toBe(store.storeName);

    expect((await owner('PUT', '/admin/settings/calendar', { cutoffTime: '25:00', workingDays: [1] })).status).toBe(400);
    expect((await owner('PUT', '/admin/settings/calendar', { cutoffTime: '15:30', workingDays: [1, 2, 3, 4, 5, 6] })).status).toBe(204);
    // The storefront calendar follows at once (cache invalidated).
    const calendar = (await (await fetch(`${base}/products/business-cards/configurator`)).json()).calendar;
    expect(calendar).toMatchObject({ cutoffTime: '15:30', workingDays: [1, 2, 3, 4, 5, 6] });

    const audit = (await owner('GET', '/admin/audit?area=settings')).body.entries;
    expect(audit[0]).toMatchObject({ action: 'settings.calendar.update', changes: { after: { cutoffTime: '15:30' } } });
    expect(audit.some((e: any) => e.action === 'settings.store.update' && e.changes.after.storeName === store.storeName)).toBe(true);
  });

  it('adds and removes holidays', async () => {
    const date = `2031-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
    expect((await owner('POST', '/admin/settings/holidays', { date, name: 'E2E day' })).status).toBe(204);
    expect((await owner('POST', '/admin/settings/holidays', { date, name: 'Again' })).status).toBe(409);
    expect((await owner('DELETE', `/admin/settings/holidays/${date}`)).status).toBe(204);
    expect((await owner('DELETE', `/admin/settings/holidays/${date}`)).status).toBe(404);
  });

  it('records catalog changes with before and after', async () => {
    await owner('PATCH', '/admin/products/business-cards/templates/minimal', { isActive: false });
    await owner('PATCH', '/admin/products/business-cards/templates/minimal', { isActive: true });
    const entries = (await owner('GET', '/admin/audit?area=catalog')).body.entries;
    expect(entries[0]).toMatchObject({ action: 'catalog.template.update', summary: 'Showed the Minimal template' });
    expect(entries[1]).toMatchObject({ action: 'catalog.template.update', summary: 'Hid the Minimal template' });
  });
});
