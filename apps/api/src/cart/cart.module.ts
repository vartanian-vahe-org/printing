import { Module } from '@nestjs/common';
import { CustomerSessionModule } from '../accounts/customer-session.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [CatalogModule, CustomerSessionModule, TemplatesModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
