/**
 * Admin password reset by email (A7) and two-step sign-in (A8) against a running stack.
 * Uses throwaway staff accounts (disabled at the end); emails are read from Mailpit.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpCounter } from '../../src/common/totp.js';
import { base, messageBody, searchMail, testHeaders, waitFor } from './helpers.js';

const ownerEmail = process.env.ADMIN_EMAIL;
const ownerPassword = process.env.ADMIN_PASSWORD;
if (!ownerEmail || !ownerPassword) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for admin e2e tests');

async function request(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...testHeaders, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], body: text ? (JSON.parse(text) as any) : null };
}

let owner = '';
const created: string[] = [];

beforeAll(async () => {
  owner = (await request('POST', '/admin/auth/login', { email: ownerEmail, password: ownerPassword })).cookie!;
});

afterAll(async () => {
  for (const id of created) await request('PATCH', `/admin/staff/${id}`, { isActive: false }, owner);
});

async function newStaff() {
  const email = `e2e-sec-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const res = await request('POST', '/admin/staff', { email, name: 'E2E Security', role: 'admin', password }, owner);
  created.push(res.body.id);
  return { id: res.body.id as string, email, password };
}

/** The code an authenticator app would show `steps` periods from now. */
const codeFor = (secret: string, steps = 0) => hotp(base32Decode(secret), totpCounter(Date.now()) + steps);

describe('admin password reset by email', () => {
  it('emails a one-time link that sets a new password and signs out old sessions', async () => {
    const person = await newStaff();
    const old = (await request('POST', '/admin/auth/login', { email: person.email, password: person.password })).cookie!;

    const unknown = await request('POST', '/admin/auth/password/forgot', { email: `nobody-${randomUUID()}@example.com` });
    const known = await request('POST', '/admin/auth/password/forgot', { email: person.email });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    const mail = await waitFor(async () => (await searchMail(`to:"${person.email}" subject:"Reset your admin password"`))[0]);
    const token = (await messageBody(mail.ID)).Text.match(/\/reset#([\w-]+)/)![1]!;
    expect((await request('POST', '/admin/auth/password/reset', { token, newPassword: 'short' })).status).toBe(400);
    expect((await request('POST', '/admin/auth/password/reset', { token, newPassword: 'a-new-admin-password' })).status).toBe(204);
    expect((await request('POST', '/admin/auth/password/reset', { token, newPassword: 'another-admin-password' })).status).toBe(400);

    expect((await request('GET', '/admin/auth/me', undefined, old)).status).toBe(401);
    expect((await request('POST', '/admin/auth/login', { email: person.email, password: 'a-new-admin-password' })).status).toBe(200);
  });
});

describe('two-step sign-in', () => {
  it('sets up with a confirmed code, then asks for a code at every sign-in', async () => {
    const person = await newStaff();
    const session = (await request('POST', '/admin/auth/login', { email: person.email, password: person.password })).cookie!;

    const setup = await request('POST', '/admin/auth/2fa/setup', undefined, session);
    expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);
    expect((await request('POST', '/admin/auth/2fa/enable', { code: '000000' }, session)).status).toBe(400);
    expect((await request('POST', '/admin/auth/2fa/enable', { code: codeFor(setup.body.secret) }, session)).status).toBe(204);
    expect((await request('GET', '/admin/auth/me', undefined, session)).body.user.twoFactorEnabled).toBe(true);

    // Password alone: a challenge, no session cookie.
    const first = await request('POST', '/admin/auth/login', { email: person.email, password: person.password });
    expect(first.body).toEqual({ twoFactorRequired: true, challenge: expect.any(String) });
    expect(first.cookie).toBeUndefined();
    expect((await request('POST', '/admin/auth/login/verify', { challenge: first.body.challenge, code: '123456' })).status).toBe(401);

    const code = codeFor(setup.body.secret, 1);
    const verified = await request('POST', '/admin/auth/login/verify', { challenge: first.body.challenge, code });
    expect(verified.status).toBe(200);
    expect(verified.cookie).toMatch(/^admin_session=/);

    // The same code cannot be used twice, even on a new challenge.
    const second = await request('POST', '/admin/auth/login', { email: person.email, password: person.password });
    expect((await request('POST', '/admin/auth/login/verify', { challenge: second.body.challenge, code })).status).toBe(401);

    // Lost phone: the owner turns it off, the password works alone again.
    expect((await request('POST', `/admin/staff/${person.id}/2fa/reset`, undefined, owner)).status).toBe(204);
    const plain = await request('POST', '/admin/auth/login', { email: person.email, password: person.password });
    expect(plain.status).toBe(200);
    expect(plain.body.user.twoFactorEnabled).toBe(false);
  });

  it('gives up a challenge after 5 wrong codes', async () => {
    const person = await newStaff();
    const session = (await request('POST', '/admin/auth/login', { email: person.email, password: person.password })).cookie!;
    const { secret } = (await request('POST', '/admin/auth/2fa/setup', undefined, session)).body;
    await request('POST', '/admin/auth/2fa/enable', { code: codeFor(secret) }, session);

    const { challenge } = (await request('POST', '/admin/auth/login', { email: person.email, password: person.password })).body;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request('POST', '/admin/auth/login/verify', { challenge, code: '111111' })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await request('POST', '/admin/auth/login/verify', { challenge, code: codeFor(secret, 1) })).status).toBe(401);
  });

  it('turning it off needs the password and a code', async () => {
    const person = await newStaff();
    const session = (await request('POST', '/admin/auth/login', { email: person.email, password: person.password })).cookie!;
    const { secret } = (await request('POST', '/admin/auth/2fa/setup', undefined, session)).body;
    await request('POST', '/admin/auth/2fa/enable', { code: codeFor(secret) }, session);
    expect((await request('POST', '/admin/auth/2fa/disable', { password: 'wrong', code: codeFor(secret, 1) }, session)).status).toBe(401);
    expect((await request('POST', '/admin/auth/2fa/disable', { password: person.password, code: codeFor(secret, -1) }, session)).status).toBe(204);
    expect((await request('GET', '/admin/auth/me', undefined, session)).body.user.twoFactorEnabled).toBe(false);
  });
});
