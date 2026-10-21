import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AdminGuard } from '../../src/admin/auth/admin.guard.js';
import { AllowStaff } from '../../src/admin/auth/allow-staff.decorator.js';
import type { SessionService, StaffIdentity } from '../../src/admin/auth/session.service.js';

class Endpoints {
  @AllowStaff()
  shipOrder() {}

  recordPayment() {}
}

function context(method: string, handler: () => void): ExecutionContext {
  const request = { method, headers: { cookie: 'admin_session=token' } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Endpoints,
  } as unknown as ExecutionContext;
}

const guardFor = (role: StaffIdentity['role'] | null) =>
  new AdminGuard(
    { resolve: async () => (role ? { id: 'u1', email: 'a@b.c', name: 'A', role } : null) } as unknown as SessionService,
    new Reflector(),
  );

describe('AdminGuard', () => {
  it('needs a session', async () => {
    await expect(guardFor(null).canActivate(context('GET', Endpoints.prototype.recordPayment))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets staff read anything and write only @AllowStaff endpoints', async () => {
    const guard = guardFor('staff');
    await expect(guard.canActivate(context('GET', Endpoints.prototype.recordPayment))).resolves.toBe(true);
    await expect(guard.canActivate(context('POST', Endpoints.prototype.shipOrder))).resolves.toBe(true);
    await expect(guard.canActivate(context('POST', Endpoints.prototype.recordPayment))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets admins write everywhere', async () => {
    await expect(guardFor('admin').canActivate(context('POST', Endpoints.prototype.recordPayment))).resolves.toBe(true);
  });
});
