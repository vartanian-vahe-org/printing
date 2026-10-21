import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../admin/auth/admin.guard.js';
import { RequireRole } from '../admin/auth/require-role.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MaintenanceService } from './maintenance.service.js';

const runSchema = z
  .object({
    cartsOlderThanDays: z.number().int().min(1).max(365).optional(),
    uploadsOlderThanDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

/** Run the daily cleanup now (owner only), e.g. before a backup. */
@Controller('admin/maintenance')
@UseGuards(AdminGuard)
@RequireRole('owner')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post('cleanup')
  @HttpCode(200)
  run(@Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.maintenance.cleanup(body);
  }
}
