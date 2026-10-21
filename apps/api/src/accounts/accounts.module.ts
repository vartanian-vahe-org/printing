import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { MailModule } from '../mail/mail.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { CustomerSessionModule } from './customer-session.module.js';

@Module({
  imports: [CartModule, MailModule, CustomerSessionModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
