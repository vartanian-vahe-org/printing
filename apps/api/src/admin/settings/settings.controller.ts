import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { RequireRole } from '../auth/require-role.decorator.js';
import { SettingsService } from './settings.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const storeSchema = z
  .object({
    storeName: z.string().trim().min(1).max(80),
    supportEmail: z.email().max(254),
    orderNotificationEmails: z.array(z.email().max(254)).max(10),
  })
  .strict();
const calendarSchema = z
  .object({
    cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1, 'Choose at least one working day').max(7),
  })
  .strict();
const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(1).max(80) }).strict();
const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  area: z.enum(['catalog', 'staff', 'settings', 'auth']).optional(),
});

/** Shop settings (owners and admins) and the admin change history (open issues A5, A1). */
@Controller('admin')
@UseGuards(AdminGuard)
@RequireRole('owner', 'admin')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  get() {
    return this.settings.get();
  }

  @Put('settings/store')
  @HttpCode(204)
  async updateStore(@Body(new ZodValidationPipe(storeSchema)) body: z.infer<typeof storeSchema>, @Req() request: AdminRequest, @Ip() ip: string) {
    await this.settings.updateStore(body, request.staff!.id, ip);
  }

  @Put('settings/calendar')
  @HttpCode(204)
  async updateCalendar(@Body(new ZodValidationPipe(calendarSchema)) body: z.infer<typeof calendarSchema>, @Req() request: AdminRequest, @Ip() ip: string) {
    await this.settings.updateCalendar(body, request.staff!.id, ip);
  }

  @Post('settings/holidays')
  @HttpCode(204)
  async addHoliday(@Body(new ZodValidationPipe(holidaySchema)) body: z.infer<typeof holidaySchema>, @Req() request: AdminRequest, @Ip() ip: string) {
    await this.settings.addHoliday(body.date, body.name, request.staff!.id, ip);
  }

  @Delete('settings/holidays/:date')
  @HttpCode(204)
  async removeHoliday(@Param('date', new ZodValidationPipe(isoDate)) date: string, @Req() request: AdminRequest, @Ip() ip: string) {
    await this.settings.removeHoliday(date, request.staff!.id, ip);
  }

  @Get('audit')
  list(@Query(new ZodValidationPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.audit.list(query.page, query.area);
  }
}
