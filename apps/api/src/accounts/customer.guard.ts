import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerSessions, customerToken, type CustomerIdentity } from './customer-session.js';

export interface CustomerRequest extends Request {
  customer?: CustomerIdentity;
}

/** Requires a signed-in customer (customer_session cookie). */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly sessions: CustomerSessions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const customer = await this.sessions.resolve(customerToken(request));
    if (!customer) throw new UnauthorizedException('Please sign in');
    request.customer = customer;
    return true;
  }
}
