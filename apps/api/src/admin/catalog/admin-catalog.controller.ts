import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { CatalogService } from '../../catalog/catalog.service.js';
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

const valueCreateSchema = z
  .object({
    /** Optional; made from the label when left out. */
    code: z
      .string()
      .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Use lowercase letters, numbers and underscores')
      .max(60)
      .optional(),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).nullable().optional(),
    attributes: z.record(z.string(), z.unknown()),
    /** Existing value of the same group whose upcharges and rules the new one starts with. */
    copyFrom: code.optional(),
  })
  .strict();

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

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(60);

const templatePatchSchema = z
  .object({ isActive: z.boolean().optional(), tags: z.record(slug, z.array(slug).max(50)).optional() })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' });

const facetsSchema = z.object({
  facets: z
    .array(
      z
        .object({
          code: slug,
          name: z.string().trim().min(1).max(60),
          values: z.array(z.object({ code: slug, name: z.string().trim().min(1).max(60) }).strict()).max(50),
        })
        .strict(),
    )
    .max(10),
});

const designTierFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable(),
  priceCents: z.number().int().min(0).max(1_000_000),
  features: z.array(z.string().trim().min(1).max(200)).max(12),
  designDays: z.number().int().min(1).max(60),
  revisions: z.number().int().min(0).max(100).nullable(),
  isActive: z.boolean(),
};

const designTierCreateSchema = z
  .object({
    code: z
      .string()
      .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Use lowercase letters, numbers and underscores')
      .max(60)
      .optional(),
    ...designTierFields,
    isActive: designTierFields.isActive.optional(),
  })
  .strict();

const designTierPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    priceCents: z.number().int().min(0).max(1_000_000).optional(),
    features: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
    designDays: z.number().int().min(1).max(60).optional(),
    revisions: z.number().int().min(0).max(100).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' });

@Controller('admin/products/:code')
@UseGuards(AdminGuard)
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly storefront: CatalogService,
  ) {}

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
    await this.storefront.invalidate(productCode);
  }

  @Post('groups/:group/values')
  async createValue(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Body(new ZodValidationPipe(valueCreateSchema)) body: z.infer<typeof valueCreateSchema>,
    @Req() request: AdminRequest,
  ) {
    const created = await this.catalog.createValue(productCode, group, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
    return created;
  }

  @Delete('groups/:group/values/:value')
  @HttpCode(204)
  async deleteValue(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Param('value') value: string,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.deleteValue(productCode, group, value, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Put('rules')
  @HttpCode(204)
  async setRule(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(ruleSchema)) body: z.infer<typeof ruleSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setRule(productCode, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Put('pricing')
  @HttpCode(204)
  async updatePricing(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(pricingSchema)) body: z.infer<typeof pricingSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updatePricing(productCode, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
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

  @Put('template-filters')
  @HttpCode(204)
  async setTemplateFilters(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(facetsSchema)) body: z.infer<typeof facetsSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setFacets(productCode, body.facets, request.staff!.id);
  }

  @Post('design-services')
  async createDesignService(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(designTierCreateSchema)) body: z.infer<typeof designTierCreateSchema>,
    @Req() request: AdminRequest,
  ) {
    return this.catalog.createDesignTier(productCode, body, request.staff!.id);
  }

  @Delete('design-services/:tier')
  @HttpCode(204)
  async deleteDesignService(@Param('code') productCode: string, @Param('tier') tier: string, @Req() request: AdminRequest) {
    await this.catalog.deleteDesignTier(productCode, tier, request.staff!.id);
  }

  @Patch('design-services/:tier')
  @HttpCode(204)
  async updateDesignService(
    @Param('code') productCode: string,
    @Param('tier') tier: string,
    @Body(new ZodValidationPipe(designTierPatchSchema)) body: z.infer<typeof designTierPatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateDesignTier(productCode, tier, body, request.staff!.id);
  }
}

/** The products the admin can configure (the product picker in the sidebar). */
@Controller('admin/products')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get()
  list() {
    return this.catalog.listProducts();
  }
}
