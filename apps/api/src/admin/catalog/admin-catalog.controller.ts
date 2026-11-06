import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AdminGuard, type AdminRequest } from '../auth/admin.guard.js';
import { CatalogService } from '../../catalog/catalog.service.js';
import { AdminCatalogService } from './admin-catalog.service.js';

const code = z.string().min(1).max(100);

const valuePatchSchema = z
  .object({ isActive: z.boolean().optional(), isDefault: z.boolean().optional() })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' });

const libraryValuePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
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
  })
  .strict();

const valueUseSchema = z
  .object({
    value: code,
    /** Option of the product whose prices and rules this one starts with. */
    copyFrom: code.optional(),
  })
  .strict();

const groupCreateSchema = z
  .object({
    /** Optional; made from the label when left out. */
    code: z
      .string()
      .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Use lowercase letters, numbers and underscores')
      .max(60)
      .optional(),
    label: z.string().trim().min(1).max(120),
    firstOption: z.string().trim().min(1).max(120),
  })
  .strict();

const groupPatchSchema = z.object({ label: z.string().trim().min(1).max(120) }).strict();

const groupValuesSchema = z
  .object({
    values: z
      .array(z.object({ code, isActive: z.boolean().optional(), addonPercent: z.number().min(-90).max(500).optional() }).strict())
      .max(500),
    default: code.optional(),
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
          isActive: z.boolean().optional(),
          isDefault: z.boolean().optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
  corePrices: z
    .array(
      z
        .object({
          size: code,
          paper: code,
          printedSide: code,
          quantity: z.number().int().positive(),
          /** null: this combination is no longer sold at this quantity. */
          priceCents: z.number().int().min(1).max(10_000_000).nullable(),
        })
        .strict(),
    )
    .max(5000)
    .optional(),
  addons: z
    .array(z.object({ group: code, value: code, percent: z.number().min(-90).max(500) }).strict())
    .max(500)
    .optional(),
});

const productCreateSchema = z
  .object({
    /** The storefront URL; made from the name when left out. */
    code: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
      .max(60)
      .optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    unitName: z.string().trim().min(1).max(40).optional(),
    unitNamePlural: z.string().trim().min(1).max(40).optional(),
    /** Left out for a blank product. */
    copyFrom: code.optional(),
  })
  .strict();

const productPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    seoTitle: z.string().trim().max(70).nullable().optional(),
    seoDescription: z.string().trim().max(170).nullable().optional(),
    unitName: z.string().trim().min(1).max(40).optional(),
    unitNamePlural: z.string().trim().min(1).max(40).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update' });

const quantity = z.number().int().min(1).max(1_000_000);
const quantitySchema = z.object({ quantity }).strict();
const productQuantitiesSchema = z
  .object({
    quantities: z.array(z.object({ quantity, isActive: z.boolean().optional() }).strict()).max(200),
    default: quantity.optional(),
  })
  .strict();

const turnaroundSchema = z.object({
  cells: z
    .array(
      z
        .object({
          value: code,
          quantity: z.number().int().positive(),
          /** The earliest day; the same as businessDays when left out. */
          minBusinessDays: z.number().int().min(1).max(60).optional(),
          businessDays: z.number().int().min(1).max(60),
          percent: z.number().min(-90).max(500).multipleOf(0.01),
        })
        .strict()
        .refine((c) => (c.minBusinessDays ?? c.businessDays) <= c.businessDays, { message: 'The first day of a range cannot be after the last' }),
    )
    .max(2000),
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
};

const designTierCreateSchema = z
  .object({
    code: z
      .string()
      .regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Use lowercase letters, numbers and underscores')
      .max(60)
      .optional(),
    ...designTierFields,
  })
  .strict();

const productDesignServicesSchema = z
  .object({
    services: z
      .array(
        z
          .object({
            code,
            /** Its name on this product; the standard name when empty. */
            displayName: z.string().trim().max(60).nullable().optional(),
            priceCents: designTierFields.priceCents,
            isActive: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50),
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

  @Put('groups/:group/values')
  @HttpCode(204)
  async setGroupValues(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Body(new ZodValidationPipe(groupValuesSchema)) body: z.infer<typeof groupValuesSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setGroupValues(productCode, group, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Post('groups/:group/values')
  @HttpCode(204)
  async useValue(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Body(new ZodValidationPipe(valueUseSchema)) body: z.infer<typeof valueUseSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.useValue(productCode, group, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Delete('groups/:group/values/:value')
  @HttpCode(204)
  async removeValue(
    @Param('code') productCode: string,
    @Param('group') group: string,
    @Param('value') value: string,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.removeValue(productCode, group, value, request.staff!.id);
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

  @Put('quantities')
  @HttpCode(204)
  async setQuantities(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(productQuantitiesSchema)) body: z.infer<typeof productQuantitiesSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setQuantities(productCode, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Post('quantities')
  @HttpCode(204)
  async createQuantity(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(quantitySchema)) body: z.infer<typeof quantitySchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.createQuantity(productCode, body.quantity, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Patch('quantities/:quantity')
  @HttpCode(204)
  async updateQuantity(
    @Param('code') productCode: string,
    @Param('quantity', ParseIntPipe) quantity: number,
    @Body(new ZodValidationPipe(quantitySchema)) body: z.infer<typeof quantitySchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateQuantity(productCode, quantity, body.quantity, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Delete('quantities/:quantity')
  @HttpCode(204)
  async deleteQuantity(@Param('code') productCode: string, @Param('quantity', ParseIntPipe) quantity: number, @Req() request: AdminRequest) {
    await this.catalog.deleteQuantity(productCode, quantity, request.staff!.id);
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

  @Put('turnarounds')
  @HttpCode(204)
  async setTurnarounds(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(turnaroundSchema)) body: z.infer<typeof turnaroundSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setTurnarounds(productCode, body.cells, request.staff!.id);
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

  @Put('design-services')
  @HttpCode(204)
  async setDesignServices(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(productDesignServicesSchema)) body: z.infer<typeof productDesignServicesSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.setDesignServices(productCode, body, request.staff!.id);
  }
}

/** The products the admin can configure (the product picker in the sidebar). */
/** The option library: every product picks from it, so a change reaches them all. */
@Controller('admin/options')
@UseGuards(AdminGuard)
export class AdminOptionsController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly storefront: CatalogService,
  ) {}

  @Get()
  list() {
    return this.catalog.getLibrary();
  }

  @Post('groups')
  createGroup(@Body(new ZodValidationPipe(groupCreateSchema)) body: z.infer<typeof groupCreateSchema>, @Req() request: AdminRequest) {
    return this.catalog.createGroup(body, request.staff!.id);
  }

  @Patch('groups/:group')
  @HttpCode(204)
  async updateGroup(
    @Param('group') group: string,
    @Body(new ZodValidationPipe(groupPatchSchema)) body: z.infer<typeof groupPatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateGroup(group, body.label, request.staff!.id);
    await this.storefront.invalidateAll();
  }

  @Delete('groups/:group')
  @HttpCode(204)
  async deleteGroup(@Param('group') group: string, @Req() request: AdminRequest) {
    await this.catalog.deleteGroup(group, request.staff!.id);
  }

  @Post('design-services')
  createDesignService(@Body(new ZodValidationPipe(designTierCreateSchema)) body: z.infer<typeof designTierCreateSchema>, @Req() request: AdminRequest) {
    return this.catalog.createDesignTier(body, request.staff!.id);
  }

  @Patch('design-services/:tier')
  @HttpCode(204)
  async updateDesignService(
    @Param('tier') tier: string,
    @Body(new ZodValidationPipe(designTierPatchSchema)) body: z.infer<typeof designTierPatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateDesignTier(tier, body, request.staff!.id);
  }

  @Delete('design-services/:tier')
  @HttpCode(204)
  async deleteDesignService(@Param('tier') tier: string, @Req() request: AdminRequest) {
    await this.catalog.deleteDesignTier(tier, request.staff!.id);
  }

  @Post('quantities')
  @HttpCode(204)
  async createQuantity(@Body(new ZodValidationPipe(quantitySchema)) body: z.infer<typeof quantitySchema>, @Req() request: AdminRequest) {
    await this.catalog.createLibraryQuantity(body.quantity, request.staff!.id);
  }

  @Patch('quantities/:quantity')
  @HttpCode(204)
  async updateQuantity(
    @Param('quantity', ParseIntPipe) from: number,
    @Body(new ZodValidationPipe(quantitySchema)) body: z.infer<typeof quantitySchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateLibraryQuantity(from, body.quantity, request.staff!.id);
    await this.storefront.invalidateAll();
  }

  @Delete('quantities/:quantity')
  @HttpCode(204)
  async deleteQuantity(@Param('quantity', ParseIntPipe) value: number, @Req() request: AdminRequest) {
    await this.catalog.deleteLibraryQuantity(value, request.staff!.id);
  }

  @Post('groups/:group/values')
  createValue(
    @Param('group') group: string,
    @Body(new ZodValidationPipe(valueCreateSchema)) body: z.infer<typeof valueCreateSchema>,
    @Req() request: AdminRequest,
  ) {
    return this.catalog.createLibraryValue(group, body, request.staff!.id);
  }

  @Patch('groups/:group/values/:value')
  @HttpCode(204)
  async updateValue(
    @Param('group') group: string,
    @Param('value') value: string,
    @Body(new ZodValidationPipe(libraryValuePatchSchema)) body: z.infer<typeof libraryValuePatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateLibraryValue(group, value, body, request.staff!.id);
    await this.storefront.invalidateAll();
  }

  @Delete('groups/:group/values/:value')
  @HttpCode(204)
  async deleteValue(@Param('group') group: string, @Param('value') value: string, @Req() request: AdminRequest) {
    await this.catalog.deleteLibraryValue(group, value, request.staff!.id);
  }
}

@Controller('admin/products')
@UseGuards(AdminGuard)
export class AdminProductsController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly storefront: CatalogService,
  ) {}

  @Get()
  list() {
    return this.catalog.listProducts();
  }

  @Post()
  create(@Body(new ZodValidationPipe(productCreateSchema)) body: z.infer<typeof productCreateSchema>, @Req() request: AdminRequest) {
    return this.catalog.createProduct(body, request.staff!.id);
  }

  @Patch(':code')
  @HttpCode(204)
  async update(
    @Param('code') productCode: string,
    @Body(new ZodValidationPipe(productPatchSchema)) body: z.infer<typeof productPatchSchema>,
    @Req() request: AdminRequest,
  ) {
    await this.catalog.updateProduct(productCode, body, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }

  @Delete(':code')
  @HttpCode(204)
  async remove(@Param('code') productCode: string, @Req() request: AdminRequest) {
    await this.catalog.deleteProduct(productCode, request.staff!.id);
    await this.storefront.invalidate(productCode);
  }
}
