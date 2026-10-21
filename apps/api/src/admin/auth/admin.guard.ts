import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_STAFF } from './allow-staff.decorator.js';
import { REQUIRED_ROLES } from './require-role.decorator.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { SessionService, type StaffIdentity } from './session.service.js';

export interface AdminRequest extends Request {
  staff?: StaffIdentity;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a valid admin session cookie. Owners and admins can change data;
 * the 'staff' role is read-only except on endpoints marked @AllowStaff(). @RequireRole() narrows
 * an endpoint to some roles (staff accounts: owner only).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const staff = token ? await this.sessions.resolve(token) : null;
    if (!staff) throw new UnauthorizedException('Please sign in');
    const roles = this.reflector.getAllAndOverride<StaffIdentity['role'][] | undefined>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(staff.role)) throw new ForbiddenException('Your account cannot do this. Ask the shop owner.');
    const staffAllowed = this.reflector.getAllAndOverride<boolean>(ALLOW_STAFF, [context.getHandler(), context.getClass()]);
    if (staff.role === 'staff' && !READ_METHODS.has(request.method) && !staffAllowed) {
      throw new ForbiddenException('Your account can view but not change settings');
    }
    request.staff = staff;
    return true;
  }
}
