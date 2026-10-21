import { Module } from '@nestjs/common';
import { AdminGuard } from './auth/admin.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { LoginLimiter } from './auth/login-limiter.js';
import { SessionService } from './auth/session.service.js';
import { AdminCatalogController } from './catalog/admin-catalog.controller.js';
import { AdminCatalogService } from './catalog/admin-catalog.service.js';

@Module({
  controllers: [AuthController, AdminCatalogController],
  providers: [SessionService, LoginLimiter, AdminGuard, AdminCatalogService],
})
export class AdminModule {}
