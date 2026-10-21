import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PrintModule } from '../print/print.module.js';
import { OrderEmailQueue } from './order-email.queue.js';
import { OrderScheduleService } from './order-schedule.service.js';
import { PrepressService } from './prepress.service.js';
import { ProofsService } from './proofs.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [CatalogModule, CommerceModule, MailModule, PrintModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEmailQueue, OrderScheduleService, PrepressService, ProofsService],
  exports: [OrdersService, OrderEmailQueue, OrderScheduleService, PrepressService, ProofsService],
})
export class OrdersModule {}
