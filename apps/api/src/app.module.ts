import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { AdminModule } from './admin/admin.module.js';
import { CartModule } from './cart/cart.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CommerceModule } from './commerce/commerce.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { PublicRateLimitMiddleware } from './redis/public-rate-limit.middleware.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule, HealthModule, CatalogModule, QuotesModule, TemplatesModule, UploadsModule, AdminModule, CommerceModule, CartModule, CheckoutModule, OrdersModule, AccountsModule, MaintenanceModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Public catalog and price reads (X3); writes have their own, tighter limits.
    consumer.apply(PublicRateLimitMiddleware).forRoutes('products', 'quotes');
  }
}
