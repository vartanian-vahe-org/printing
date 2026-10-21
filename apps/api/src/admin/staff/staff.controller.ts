import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { RequireRole } from '../auth/require-role.decorator.js';
import { passwordSchema } from './passwords.js';
import { TwoFactorService } from '../auth/two-factor.service.js';
import { StaffService } from './staff.service.js';

const role = z.enum(['owner', 'admin', 'staff']);
const createSchema = z
  .object({ email: z.email().max(254), name: z.string().trim().min(1).max(100), role, password: passwordSchema })
  .strict();
const patchSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), role: role.optional(), isActive: z.boolean().optional() })
  .strict();
const resetSchema = z.object({ password: passwordSchema }).strict();

/** Staff accounts: the shop owner only (open issue A2). */
@Controller('admin/staff')
@UseGuards(AdminGuard)
@RequireRole('owner')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get()
  list() {
    return this.staff.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>, @Req() request: AdminRequest, @Ip() ip: string) {
    return this.staff.create(body, request.staff!.id, ip);
  }

  @Patch(':id')
  @HttpCode(204)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: z.infer<typeof patchSchema>,
    @Req() request: AdminRequest,
    @Ip() ip: string,
  ) {
    await this.staff.update(id, body, request.staff!.id, ip);
  }

  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(resetSchema)) body: z.infer<typeof resetSchema>,
    @Req() request: AdminRequest,
    @Ip() ip: string,
  ) {
    await this.staff.resetPassword(id, body.password, request.staff!.id, ip);
  }

  /** For someone who lost their phone: turns two-step sign-in off so they can sign in and set it up again. */
  @Post(':id/2fa/reset')
  @HttpCode(204)
  async resetTwoFactor(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AdminRequest, @Ip() ip: string) {
    await this.twoFactor.resetFor(id, request.staff!.id, ip);
  }
}
