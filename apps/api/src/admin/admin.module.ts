import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PrintModule } from '../print/print.module.js';
import { AuditService } from './audit/audit.service.js';
import { AdminGuard } from './auth/admin.guard.js';
import { StaffResetService } from './auth/staff-reset.service.js';
import { TwoFactorService } from './auth/two-factor.service.js';
import { MailModule } from '../mail/mail.module.js';
import { AuthController } from './auth/auth.controller.js';
import { LoginLimiter } from './auth/login-limiter.js';
import { SessionService } from './auth/session.service.js';
import { AdminCatalogController } from './catalog/admin-catalog.controller.js';
import { AdminCatalogService } from './catalog/admin-catalog.service.js';
import { AdminOrdersController } from './orders/admin-orders.controller.js';
import { AdminOrdersService } from './orders/admin-orders.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { StaffController } from './staff/staff.controller.js';
import { StaffService } from './staff/staff.service.js';

@Module({
  imports: [CatalogModule, MailModule, OrdersModule, PrintModule],
  controllers: [AuthController, AdminCatalogController, AdminOrdersController, StaffController, SettingsController],
  providers: [SessionService, LoginLimiter, AdminGuard, AdminCatalogService, AdminOrdersService, AuditService, StaffService, SettingsService, StaffResetService, TwoFactorService],
})
export class AdminModule {}
