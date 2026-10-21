import { Module } from '@nestjs/common';
import { SessionService } from '../admin/auth/session.service.js';
import { AdminGuard } from '../admin/auth/admin.guard.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, SessionService, AdminGuard],
})
export class MaintenanceModule {}
