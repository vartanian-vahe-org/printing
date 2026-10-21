import { Module } from '@nestjs/common';
import { CustomerGuard } from './customer.guard.js';
import { CustomerSessions } from './customer-session.js';

/** Customer sessions on their own, so the cart and checkout can read who is signed in. */
@Module({ providers: [CustomerSessions, CustomerGuard], exports: [CustomerSessions, CustomerGuard] })
export class CustomerSessionModule {}
