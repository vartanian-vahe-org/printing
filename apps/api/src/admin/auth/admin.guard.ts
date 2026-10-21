import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { SessionService, type StaffIdentity } from './session.service.js';

export interface AdminRequest extends Request {
  staff?: StaffIdentity;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a valid admin session cookie. Owners and admins can change data;
 * the 'staff' role is read-only.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const staff = token ? await this.sessions.resolve(token) : null;
    if (!staff) throw new UnauthorizedException('Please sign in');
    if (staff.role === 'staff' && !READ_METHODS.has(request.method)) {
      throw new ForbiddenException('Your account can view but not change settings');
    }
    request.staff = staff;
    return true;
  }
}
