import { Module } from '@nestjs/common';
import { CustomerSessionModule } from '../accounts/customer-session.module.js';
import { CartModule } from '../cart/cart.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CommerceModule } from '../commerce/commerce.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';

@Module({
  imports: [CartModule, CatalogModule, CommerceModule, CustomerSessionModule, OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
