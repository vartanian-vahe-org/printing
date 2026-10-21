import { Body, Controller, Get, HttpCode, Param, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const code = z.string().min(1).max(100);
const cents = z.number().int().min(-1_000_000).max(10_000_000);

const valuePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' });

const ruleSchema = z.object({
  whenGroup: code,
  whenValue: code,
  targetGroup: code,
  allowed: z.array(code).max(100).nullable(),
});

const pricingSchema = z.object({
  tiers: z
    .array(
      z
        .object({
          quantity: z.number().int().positive(),
          basePriceCents: z.number().int().min(0).max(10_000_000).optional(),
          isActive: z.boolean().optional(),
          isDefault: z.boolean().optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
  upcharges: z
    .array(z.object({ group: code, value: code, quantity: z.number().int().positive(), upchargeCents: cents }).strict())
    .max(2000)
    .optional(),
});

const templatePatchSchema = z.object({ isActive: z.boolean() }).strict();

@Controller('admin/products/:code')
@UseGuards(AdminGuard)
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('catalog')
  get(@Param('code') productCode: string) {
    return this.catalog.getCatalog(productCode);
  }

  @Patch('groups/:group/values/:value')
  @HttpCode(204)
  async updateValue(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Param('value') value: string,
    @Body(new ZodValidationPipe(valuePatchSchema)) body: z.infer<typeof valuePatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateValue(productCode, group, value, body, request.staff!.id);
  }

  @Put('rules')
  @HttpCode(204)
  async setRule(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(ruleSchema)) body: z.infer<typeof ruleSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setRule(productCode, body, request.staff!.id);
  }

  @Put('pricing')
  @HttpCode(204)
  async updatePricing(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(pricingSchema)) body: z.infer<typeof pricingSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updatePricing(productCode, body, request.staff!.id);
  }

  @Patch('templates/:template')
  @HttpCode(204)
  async updateTemplate(
    @Param('code') productCode: string,
    @Param('template') template: string,
    @Body(new ZodValidationPipe(templatePatchSchema)) body: z.infer<typeof templatePatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateTemplate(productCode, template, body, request.staff!.id);
  }
}
