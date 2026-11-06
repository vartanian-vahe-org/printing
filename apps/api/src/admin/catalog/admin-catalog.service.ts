import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  corePrices,
  type Database,
  designServiceTiers,
  libraryQuantities,
  optionGroups,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
  productDesignServices,
  productOptionValues,
  productQuantityTiers,
  products,
  templateFacets,
  templates,
  turnaroundOptions,
} from '@printing/db';
import {
  CORE_GROUPS,
  corePriceAt,
  InvalidConfigurationError,
  PAPER_GROUP,
  PRINTED_SIDE_GROUP,
  quote,
  resolveSelection,
  SIZE_GROUP,
  sortedTiers,
  TURNAROUND_GROUP,
  UnsatisfiableSelectionError,
} from '@printing/pricing';
import { and, asc, desc, eq, inArray, max, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CatalogService } from '../../catalog/catalog.service.js';
import { DATABASE } from '../../database/database.tokens.js';
import { AuditService } from '../audit/audit.service.js';
import { attributeSchema } from './attribute-schemas.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** How a product uses a library option. */
export interface ValuePatch {
  isActive?: boolean;
  isDefault?: boolean;
}

/** Adds a library option to a product; `copyFrom` is an option of the product whose prices and rules it starts with. */
export interface ValueUseInput {
  value: string;
  copyFrom?: string;
}

/** Everything a product offers in a group, saved at once. */
export interface GroupValuesInput {
  values: { code: string; isActive?: boolean; addonPercent?: number }[];
  default?: string;
}

/** Everything a product sells in quantities, saved at once. */
export interface ProductQuantitiesInput {
  quantities: { quantity: number; isActive?: boolean }[];
  default?: number;
}

export interface LibraryValueInput {
  code?: string;
  label: string;
  description?: string | null;
  attributes: Record<string, unknown>;
}

export interface LibraryValuePatch {
  label?: string;
  description?: string | null;
  sortOrder?: number;
  attributes?: Record<string, unknown>;
}

export interface ProductInput {
  code?: string;
  name: string;
  description?: string | null;
  unitName?: string;
  unitNamePlural?: string;
  /** Existing product whose whole configuration the new one starts with; left out for a blank product. */
  copyFrom?: string;
}

export interface GroupInput {
  code?: string;
  label: string;
  /** A group always has an option, so a live product keeps working: this one becomes its default. */
  firstOption: string;
}

export interface ProductPatch {
  name?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  unitName?: string;
  unitNamePlural?: string;
  sortOrder?: number;
  isActive?: boolean;
}

/** Top-level pages of the storefront: a product cannot take their URL. */
const RESERVED_PRODUCT_CODES = ['account', 'api', 'cart', 'checkout', 'fonts', 'orders'];

/** "Premium Business Cards!" -> "premium-business-cards" */
export function productCodeFrom(name: string): string {
  const code = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return code || 'product';
}

/** "Envelopes" -> envelope / envelopes, "Flyer" -> flyer / flyers. Admins can correct it on the product. */
export function unitNamesFrom(name: string): { unitName: string; unitNamePlural: string } {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('s') && !lower.endsWith('ss')) return { unitName: lower.slice(0, -1), unitNamePlural: lower };
  return { unitName: lower, unitNamePlural: lower.endsWith('ss') ? `${lower}es` : `${lower}s` };
}

/** The values of `row` for a copy: the database gives it a new id and dates. */
function copyRow<T extends { createdAt: Date; updatedAt: Date }>(row: T, staffId: string) {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = row as T & { id?: string };
  return { ...values, createdBy: staffId, updatedBy: staffId };
}

/** "Premium – 18pt Cardstock" -> "premium_18pt_cardstock" */
export function valueCodeFrom(label: string): string {
  const code = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/, '');
  return code || 'option';
}

export interface RuleInput {
  whenGroup: string;
  whenValue: string;
  targetGroup: string;
  /** null removes the rule (no restriction). */
  allowed: string[] | null;
}

export interface TemplatePatch {
  isActive?: boolean;
  /** Filter values by facet code; replaces the template's tags. */
  tags?: Record<string, string[]>;
}

export interface FacetInput {
  code: string;
  name: string;
  values: { code: string; name: string }[];
}

export interface DesignTierPatch {
  name?: string;
  description?: string | null;
  priceCents?: number;
  features?: string[];
  designDays?: number;
  revisions?: number | null;
  sortOrder?: number;
}

export interface DesignTierInput {
  code?: string;
  name: string;
  description: string | null;
  priceCents: number;
  features: string[];
  designDays: number;
  revisions: number | null;
}

/** What a product offers from the design library: its own name for a package, when set, and its price. */
export interface ProductDesignServicesInput {
  services: { code: string; displayName?: string | null; priceCents: number; isActive?: boolean }[];
}

/** One offered cell of the quantity × speed table; cells left out are not offered. */
export interface TurnaroundCell {
  value: string;
  quantity: number;
  minBusinessDays?: number;
  businessDays: number;
  percent: number;
}

export interface PricingInput {
  tiers?: { quantity: number; isActive?: boolean; isDefault?: boolean }[];
  /** A null price takes that combination off sale at that quantity. */
  corePrices?: { size: string; paper: string; printedSide: string; quantity: number; priceCents: number | null }[];
  addons?: { group: string; value: string; percent: number }[];
}

const isCoreGroup = (code: string) => (CORE_GROUPS as readonly string[]).includes(code);

/** The groups every product needs: the pricing engine uses them, so they can be renamed but not deleted. */
const isRequiredGroup = (code: string) => isCoreGroup(code) || code === TURNAROUND_GROUP;

/** Details of the first option of an add-on group the 3D preview reads; other groups have none. */
const FIRST_OPTION_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  coating: { front: 'none', back: 'none', laminated: false },
  corners: { radius_in: 0 },
};

/** core_prices column holding the value of each core group. */
const CORE_COLUMN = {
  [SIZE_GROUP]: 'sizeValueId',
  [PAPER_GROUP]: 'paperValueId',
  [PRINTED_SIDE_GROUP]: 'printedSideValueId',
} as const;

/**
 * Admin reads and writes of a product's configuration. Every write runs in a transaction and is
 * checked before commit: the storefront must still be able to build a default selection and price it.
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private async productId(db: Executor, code: string): Promise<string> {
    const [row] = await db.select({ id: products.id }).from(products).where(eq(products.code, code)).limit(1);
    if (!row) throw new NotFoundException(`Product "${code}" not found`);
    return row.id;
  }

  private async groupId(db: Executor, code: string): Promise<string> {
    const [row] = await db.select({ id: optionGroups.id }).from(optionGroups).where(eq(optionGroups.code, code)).limit(1);
    if (!row) throw new NotFoundException(`Option group "${code}" not found`);
    return row.id;
  }

  /** The options of a group this product uses, by code. */
  private async valueIds(db: Executor, productId: string, groupId: string): Promise<Map<string, { id: string; isActive: boolean; isDefault: boolean }>> {
    const rows = await db
      .select({ id: optionValues.id, code: optionValues.code, isActive: productOptionValues.isActive, isDefault: productOptionValues.isDefault })
      .from(productOptionValues)
      .innerJoin(optionValues, eq(optionValues.id, productOptionValues.valueId))
      .where(and(eq(productOptionValues.productId, productId), eq(productOptionValues.groupId, groupId)));
    return new Map(rows.map((r) => [r.code, r]));
  }

  private async productTierIds(db: Executor, productId: string): Promise<string[]> {
    const rows = await db.select({ id: productQuantityTiers.id }).from(productQuantityTiers).where(eq(productQuantityTiers.productId, productId));
    return rows.map((r) => r.id);
  }

  /**
   * Fails the transaction if the storefront could no longer open a live product. A hidden one may be
   * unfinished: it is checked when shown, and the Products page lists what is missing.
   */
  private async assertStorefrontStillWorks(tx: Tx, productCode: string) {
    const [product] = await tx.select({ isActive: products.isActive }).from(products).where(eq(products.code, productCode));
    if (product?.isActive) await this.assertSellable(tx, productCode);
  }

  /** Every required group needs an option, the default options a price at the default quantity, and each quantity a turnaround speed. */
  private async assertSellable(db: Executor, productCode: string) {
    let quantity: number | null = null;
    try {
      const catalog = await new CatalogService(db as unknown as Database).readCatalog(productCode, { includeHidden: true });
      const empty = catalog.groups.filter((g) => g.values.length === 0).map((g) => g.label);
      if (empty.length) throw new BadRequestException(`Add at least one option to: ${empty.join(', ')}.`);
      const tiers = sortedTiers(catalog);
      if (tiers.length === 0) throw new BadRequestException('Add at least one quantity.');
      if (catalog.corePrices.length === 0) throw new BadRequestException('Enter prices on the Pricing page.');
      for (const tier of tiers) {
        quantity = tier.quantity;
        const selection = resolveSelection(catalog, {}, tier.quantity);
        if (corePriceAt(catalog, selection, tier.quantity)) quote(catalog, { selection, quantity: tier.quantity });
        else if (tier.isDefault) throw new BadRequestException(`The default options need a price at the default quantity (${tier.quantity.toLocaleString('en-US')}).`);
      }
    } catch (err) {
      if (err instanceof UnsatisfiableSelectionError) {
        if (err.groupCode === TURNAROUND_GROUP && quantity !== null) {
          throw new BadRequestException(`No turnaround would be offered at quantity ${quantity.toLocaleString('en-US')}. Offer at least one speed at every quantity.`);
        }
        throw new BadRequestException(`This change leaves "${err.groupCode}" with no available option. Allow at least one.`);
      }
      if (err instanceof InvalidConfigurationError) {
        throw new BadRequestException(`This change breaks the default configuration: ${err.issues.join('; ')}`);
      }
      throw err;
    }
  }

  /** Why a product cannot go on the storefront yet; null when it can. */
  private async setupIssue(productCode: string): Promise<string | null> {
    try {
      await this.assertSellable(this.db, productCode);
      return null;
    } catch (err) {
      if (err instanceof BadRequestException) return err.message;
      throw err;
    }
  }

  // ---------------------------------------------------------------- read

  async listProducts() {
    const rows = await this.db
      .select({
        code: products.code,
        name: products.name,
        description: products.description,
        seoTitle: products.seoTitle,
        seoDescription: products.seoDescription,
        unitName: products.unitName,
        unitNamePlural: products.unitNamePlural,
        sortOrder: products.sortOrder,
        isActive: products.isActive,
      })
      .from(products)
      .orderBy(asc(products.sortOrder), asc(products.name));
    return { products: await Promise.all(rows.map(async (row) => ({ ...row, setupIssue: await this.setupIssue(row.code) }))) };
  }

  async getCatalog(productCode: string) {
    const productId = await this.productId(this.db, productCode);
    const [product] = await this.db.select({ name: products.name }).from(products).where(eq(products.id, productId));
    const whenGroup = alias(optionGroups, 'when_group');
    const targetGroup = alias(optionGroups, 'target_group');
    const allowedValue = alias(optionValues, 'allowed_value');
    const sizeValue = alias(optionValues, 'size_value');
    const paperValue = alias(optionValues, 'paper_value');
    const sideValue = alias(optionValues, 'side_value');

    const [groups, values, rules, allowed, tiers, prices, turnaroundRows, templateRows, facetRows, designRows] = await Promise.all([
      this.db.select().from(optionGroups).orderBy(asc(optionGroups.sortOrder)),
      this.db
        .select({ value: optionValues, use: productOptionValues, groupCode: optionGroups.code })
        .from(productOptionValues)
        .innerJoin(optionValues, eq(optionValues.id, productOptionValues.valueId))
        .innerJoin(optionGroups, eq(optionGroups.id, productOptionValues.groupId))
        .where(eq(productOptionValues.productId, productId))
        .orderBy(asc(optionValues.sortOrder)),
      this.db
        .select({ id: optionValueRules.id, whenGroup: whenGroup.code, whenValue: optionValues.code, targetGroup: targetGroup.code })
        .from(optionValueRules)
        .innerJoin(optionValues, eq(optionValues.id, optionValueRules.whenValueId))
        .innerJoin(whenGroup, eq(whenGroup.id, optionValues.groupId))
        .innerJoin(targetGroup, eq(targetGroup.id, optionValueRules.targetGroupId))
        .where(eq(optionValueRules.productId, productId)),
      this.db
        .select({ ruleId: optionValueRuleAllowed.ruleId, value: allowedValue.code, sortOrder: allowedValue.sortOrder })
        .from(optionValueRuleAllowed)
        .innerJoin(allowedValue, eq(allowedValue.id, optionValueRuleAllowed.valueId))
        .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
        .where(eq(optionValueRules.productId, productId))
        .orderBy(asc(allowedValue.sortOrder)),
      this.db
        .select()
        .from(productQuantityTiers)
        .where(eq(productQuantityTiers.productId, productId))
        .orderBy(asc(productQuantityTiers.sortOrder)),
      this.db
        .select({
          size: sizeValue.code,
          paper: paperValue.code,
          printedSide: sideValue.code,
          quantity: productQuantityTiers.quantity,
          priceCents: corePrices.priceCents,
        })
        .from(corePrices)
        .innerJoin(sizeValue, eq(sizeValue.id, corePrices.sizeValueId))
        .innerJoin(paperValue, eq(paperValue.id, corePrices.paperValueId))
        .innerJoin(sideValue, eq(sideValue.id, corePrices.printedSideValueId))
        .innerJoin(productQuantityTiers, eq(productQuantityTiers.id, corePrices.quantityTierId))
        .where(eq(productQuantityTiers.productId, productId)),
      this.db
        .select({
          value: optionValues.code,
          quantity: productQuantityTiers.quantity,
          minBusinessDays: turnaroundOptions.minBusinessDays,
          businessDays: turnaroundOptions.businessDays,
          percent: turnaroundOptions.pricePercent,
        })
        .from(turnaroundOptions)
        .innerJoin(optionValues, eq(optionValues.id, turnaroundOptions.optionValueId))
        .innerJoin(productQuantityTiers, eq(productQuantityTiers.id, turnaroundOptions.quantityTierId))
        .where(eq(productQuantityTiers.productId, productId)),
      this.db.select().from(templates).where(eq(templates.productId, productId)).orderBy(asc(templates.sortOrder)),
      this.db.select().from(templateFacets).where(eq(templateFacets.productId, productId)).orderBy(asc(templateFacets.sortOrder)),
      this.db
        .select({ tier: designServiceTiers, use: productDesignServices })
        .from(productDesignServices)
        .innerJoin(designServiceTiers, eq(designServiceTiers.id, productDesignServices.tierId))
        .where(eq(productDesignServices.productId, productId))
        .orderBy(asc(designServiceTiers.sortOrder)),
    ]);

    return {
      product: { code: productCode, name: product!.name },
      // The required groups, and the add-on groups the product uses.
      groups: groups
        .filter((g) => isRequiredGroup(g.code) || values.some((v) => v.groupCode === g.code))
        .map((g) => ({
          code: g.code,
          label: g.label,
          sortOrder: g.sortOrder,
          displayStyle: g.displayStyle,
          values: values
            .filter((v) => v.groupCode === g.code)
            .map(({ value: v, use }) => ({
              code: v.code,
              label: v.label,
              description: v.description,
              sortOrder: v.sortOrder,
              isActive: use.isActive,
              isDefault: use.isDefault,
              attributes: v.attributes,
              addonPercent: use.addonPercent,
              updatedAt: v.updatedAt,
            })),
        })),
      rules: rules.map((r) => ({
        whenGroup: r.whenGroup,
        whenValue: r.whenValue,
        targetGroup: r.targetGroup,
        allowed: allowed.filter((a) => a.ruleId === r.id).map((a) => a.value),
      })),
      quantityTiers: tiers.map((t) => ({
        quantity: t.quantity,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
        isDefault: t.isDefault,
      })),
      corePrices: prices,
      turnarounds: turnaroundRows,
      templates: templateRows.map((t) => ({
        code: t.code,
        name: t.name,
        description: t.description,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
        supportedSizeCodes: t.supportedSizeCodes,
        tags: t.tags,
      })),
      templateFacets: facetRows.map((f) => ({ code: f.code, name: f.name, values: f.values })),
      designServices: designRows.map(({ tier, use }) => ({
        code: tier.code,
        name: use.displayName ?? tier.name,
        standardName: tier.name,
        displayName: use.displayName,
        priceCents: use.priceCents,
        sortOrder: tier.sortOrder,
        isActive: use.isActive,
      })),
    };
  }

  // ---------------------------------------------------------------- writes

  /** Shows, hides or makes default a library option on this product. */
  async updateValue(productCode: string, groupCode: string, valueCode: string, patch: ValuePatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, groupCode);
      const existing = (await this.valueIds(tx, productId, groupId)).get(valueCode);
      if (!existing) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);

      const willBeActive = patch.isActive ?? existing.isActive;
      const willBeDefault = patch.isDefault ?? existing.isDefault;
      if (willBeDefault && !willBeActive) {
        throw new BadRequestException('The default option must be active. Choose another default before hiding this one.');
      }
      if (patch.isDefault === false && existing.isDefault) {
        throw new BadRequestException('Each option group needs a default. Make another option the default instead.');
      }

      const inGroup = and(eq(productOptionValues.productId, productId), eq(productOptionValues.groupId, groupId));
      if (patch.isDefault === true) {
        await tx.update(productOptionValues).set({ isDefault: false, updatedBy: staffId }).where(and(inGroup, ne(productOptionValues.valueId, existing.id)));
      }
      await tx.update(productOptionValues).set({ ...patch, updatedBy: staffId }).where(and(inGroup, eq(productOptionValues.valueId, existing.id)));

      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.update',
        target: `${productCode} · ${groupCode} / ${valueCode}`,
        summary: `Changed ${Object.keys(patch).join(', ')} of ${valueCode}`,
        changes: { before: { isActive: existing.isActive, isDefault: existing.isDefault }, after: patch },
      });
    });
  }

  private parseAttributes(groupCode: string, attributes: Record<string, unknown>) {
    const parsed = attributeSchema(groupCode).safeParse(attributes);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid attributes',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'attributes'}: ${i.message}`),
      });
    }
  }

  /**
   * Adds a library option to a product, active and not the default (unless it is the product's first in the
   * group). With `copyFrom` it starts with that option's prices, turnaround days and rules (and, for sizes,
   * its templates). Otherwise a new add-on is 0%, a new core option is not sold until it has prices, a new
   * turnaround speed is offered at no quantity until set in the table, rules that limit its group leave it
   * out, and every template supports a new size (layouts adapt to any size).
   */
  async useValue(productCode: string, groupCode: string, input: ValueUseInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, groupCode);
      const label = await this.attachValue(tx, productId, groupId, groupCode, input, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.use',
        target: `${productCode} · ${groupCode} / ${input.value}`,
        summary: `Added ${label}${input.copyFrom ? ` (prices and rules copied from ${input.copyFrom})` : ''}`,
        changes: { before: null, after: { value: input.value, copyFrom: input.copyFrom ?? null } },
      });
    });
  }

  private async attachValue(tx: Tx, productId: string, groupId: string, groupCode: string, input: ValueUseInput, staffId: string): Promise<string> {
    const [value] = await tx
      .select({ id: optionValues.id, label: optionValues.label })
      .from(optionValues)
      .where(and(eq(optionValues.groupId, groupId), eq(optionValues.code, input.value)));
    if (!value) throw new NotFoundException(`Value "${input.value}" not found in "${groupCode}"`);
    const used = await this.valueIds(tx, productId, groupId);
    if (used.has(input.value)) throw new BadRequestException(`This product already uses ${value.label}.`);
    const source = input.copyFrom ? used.get(input.copyFrom) : undefined;
    if (input.copyFrom && !source) throw new BadRequestException(`Option "${input.copyFrom}" not found in "${groupCode}"`);
    const id = value.id;

    let addonPercent = 0;
    if (source) {
      const [row] = await tx
        .select({ addonPercent: productOptionValues.addonPercent })
        .from(productOptionValues)
        .where(and(eq(productOptionValues.productId, productId), eq(productOptionValues.valueId, source.id)));
      addonPercent = row?.addonPercent ?? 0;
    }
    await tx.insert(productOptionValues).values({ productId, groupId, valueId: id, isDefault: used.size === 0, addonPercent, createdBy: staffId, updatedBy: staffId });

    if (source) {
      const tierIds = await this.productTierIds(tx, productId);
      if (isCoreGroup(groupCode) && tierIds.length) {
        const column = CORE_COLUMN[groupCode as keyof typeof CORE_COLUMN];
        const prices = await tx.select().from(corePrices).where(and(eq(corePrices[column], source.id), inArray(corePrices.quantityTierId, tierIds)));
        if (prices.length) {
          await tx.insert(corePrices).values(
            prices.map(({ sizeValueId, paperValueId, printedSideValueId, quantityTierId, priceCents }) => ({
              sizeValueId,
              paperValueId,
              printedSideValueId,
              quantityTierId,
              priceCents,
              [column]: id,
              createdBy: staffId,
              updatedBy: staffId,
            })),
          );
        }
      }
      const cells = tierIds.length
        ? await tx.select().from(turnaroundOptions).where(and(eq(turnaroundOptions.optionValueId, source.id), inArray(turnaroundOptions.quantityTierId, tierIds)))
        : [];
      if (cells.length) {
        await tx.insert(turnaroundOptions).values(
          cells.map((c) => ({ optionValueId: id, quantityTierId: c.quantityTierId, minBusinessDays: c.minBusinessDays, businessDays: c.businessDays, pricePercent: c.pricePercent, createdBy: staffId, updatedBy: staffId })),
        );
      }
      // Its own rules: "when the customer picks <source>, only … in group Y".
      const ownRules = await tx.select().from(optionValueRules).where(and(eq(optionValueRules.productId, productId), eq(optionValueRules.whenValueId, source.id)));
      for (const rule of ownRules) {
        const allowed = await tx.select().from(optionValueRuleAllowed).where(eq(optionValueRuleAllowed.ruleId, rule.id));
        const [copy] = await tx
          .insert(optionValueRules)
          .values({ productId, whenValueId: id, targetGroupId: rule.targetGroupId, createdBy: staffId, updatedBy: staffId })
          .returning({ id: optionValueRules.id });
        await tx.insert(optionValueRuleAllowed).values(allowed.map((a) => ({ ruleId: copy!.id, valueId: a.valueId })));
      }
      // Rules of other options that allow <source> allow the new one too.
      const allowing = await tx
        .select({ ruleId: optionValueRuleAllowed.ruleId })
        .from(optionValueRuleAllowed)
        .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
        .where(and(eq(optionValueRules.productId, productId), eq(optionValueRuleAllowed.valueId, source.id)));
      if (allowing.length) await tx.insert(optionValueRuleAllowed).values(allowing.map((a) => ({ ruleId: a.ruleId, valueId: id })));
    }

    if (groupCode === SIZE_GROUP) {
      const rows = await tx.select({ id: templates.id, sizes: templates.supportedSizeCodes }).from(templates).where(eq(templates.productId, productId));
      for (const row of rows) {
        if (input.copyFrom && !row.sizes.includes(input.copyFrom)) continue;
        await tx.update(templates).set({ supportedSizeCodes: [...row.sizes, input.value], updatedBy: staffId }).where(eq(templates.id, row.id));
      }
    }
    return value.label;
  }

  /**
   * Takes a library option off a product, with its prices and rules on that product. The option stays in the
   * library. Carts holding it ask the customer to choose again; placed orders keep their own copy of the
   * configuration. Refused for the default while the group has other options, and when a rule would be left
   * allowing nothing. Removing the last option takes an add-on group off the product.
   */
  async removeValue(productCode: string, groupCode: string, valueCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, groupCode);
      const label = await this.detachValue(tx, productId, groupId, groupCode, valueCode, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.remove',
        target: `${productCode} · ${groupCode} / ${valueCode}`,
        summary: `Removed ${label}`,
        changes: { before: { code: valueCode, label }, after: null },
      });
    });
  }

  /**
   * Saves what a product offers in a group in one go: options left out are removed as in `removeValue`, new
   * ones start as in `useValue`, and the default falls back to the first option when it was removed.
   */
  async setGroupValues(productCode: string, groupCode: string, input: GroupValuesInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, groupCode);
      const used = await this.valueIds(tx, productId, groupId);
      const wanted = input.values.map((v) => v.code);
      if (new Set(wanted).size !== wanted.length) throw new BadRequestException('An option is listed twice');

      const defaultCode = input.default ?? [...used].find(([code, v]) => v.isDefault && wanted.includes(code))?.[0] ?? wanted[0];
      if (defaultCode && !wanted.includes(defaultCode)) throw new BadRequestException('The default must be one of the options');
      if (input.values.find((v) => v.code === defaultCode)?.isActive === false) {
        throw new BadRequestException('The default option must be active. Choose another default before hiding this one.');
      }

      const inGroup = and(eq(productOptionValues.productId, productId), eq(productOptionValues.groupId, groupId));
      await tx.update(productOptionValues).set({ isDefault: false, updatedBy: staffId }).where(inGroup);
      const removed = [...used.keys()].filter((code) => !wanted.includes(code));
      for (const code of removed) await this.detachValue(tx, productId, groupId, groupCode, code, staffId);
      const added = wanted.filter((code) => !used.has(code));
      for (const code of added) await this.attachValue(tx, productId, groupId, groupCode, { value: code }, staffId);

      await tx.update(productOptionValues).set({ isDefault: false, updatedBy: staffId }).where(inGroup);
      const now = await this.valueIds(tx, productId, groupId);
      for (const value of input.values) {
        await tx
          .update(productOptionValues)
          .set({
            isDefault: value.code === defaultCode,
            ...(value.isActive === undefined ? {} : { isActive: value.isActive }),
            ...(value.addonPercent === undefined ? {} : { addonPercent: value.addonPercent }),
            updatedBy: staffId,
          })
          .where(and(inGroup, eq(productOptionValues.valueId, now.get(value.code)!.id)));
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.pick',
        target: `${productCode} · ${groupCode}`,
        summary: `Offers ${wanted.length} option(s): ${added.length} added, ${removed.length} removed`,
        changes: { before: [...used.keys()].sort(), after: [...wanted].sort(), default: defaultCode ?? null },
      });
    });
  }

  private async detachValue(tx: Tx, productId: string, groupId: string, groupCode: string, valueCode: string, staffId: string): Promise<string> {
    const used = await this.valueIds(tx, productId, groupId);
    const value = used.get(valueCode);
    if (!value) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);
    if (value.isDefault && used.size > 1) throw new BadRequestException('This is the default option. Make another option the default before removing it.');
    const [{ label } = { label: valueCode }] = await tx.select({ label: optionValues.label }).from(optionValues).where(eq(optionValues.id, value.id));

    // Rules whose only allowed option is this one would leave customers nothing to pick.
    const restricting = await tx
      .select({ ruleId: optionValueRuleAllowed.ruleId, valueId: optionValueRuleAllowed.valueId })
      .from(optionValueRuleAllowed)
      .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
      .where(and(eq(optionValueRules.productId, productId), eq(optionValueRules.targetGroupId, groupId)));
    const onlyHere = [...new Set(restricting.filter((r) => r.valueId === value.id).map((r) => r.ruleId))].filter(
      (ruleId) => restricting.filter((r) => r.ruleId === ruleId).length === 1,
    );
    if (onlyHere.length) {
      const blockers = await tx
        .select({ label: optionValues.label })
        .from(optionValueRules)
        .innerJoin(optionValues, eq(optionValues.id, optionValueRules.whenValueId))
        .where(inArray(optionValueRules.id, onlyHere));
      throw new BadRequestException(`${label} is the only option allowed with ${blockers.map((b) => b.label).join(', ')}. Change that rule first.`);
    }

    await tx.delete(productOptionValues).where(and(eq(productOptionValues.productId, productId), eq(productOptionValues.valueId, value.id)));
    await tx.delete(optionValueRules).where(and(eq(optionValueRules.productId, productId), eq(optionValueRules.whenValueId, value.id)));
    const ruleIds = (await tx.select({ id: optionValueRules.id }).from(optionValueRules).where(eq(optionValueRules.productId, productId))).map((r) => r.id);
    if (ruleIds.length) await tx.delete(optionValueRuleAllowed).where(and(inArray(optionValueRuleAllowed.ruleId, ruleIds), eq(optionValueRuleAllowed.valueId, value.id)));
    const tierIds = await this.productTierIds(tx, productId);
    if (tierIds.length) {
      await tx.delete(turnaroundOptions).where(and(eq(turnaroundOptions.optionValueId, value.id), inArray(turnaroundOptions.quantityTierId, tierIds)));
      if (isCoreGroup(groupCode)) {
        const column = CORE_COLUMN[groupCode as keyof typeof CORE_COLUMN];
        await tx.delete(corePrices).where(and(eq(corePrices[column], value.id), inArray(corePrices.quantityTierId, tierIds)));
      }
    }

    if (groupCode === SIZE_GROUP) {
      const rows = await tx.select({ id: templates.id, sizes: templates.supportedSizeCodes }).from(templates).where(eq(templates.productId, productId));
      for (const row of rows.filter((r) => r.sizes.includes(valueCode))) {
        await tx.update(templates).set({ supportedSizeCodes: row.sizes.filter((s) => s !== valueCode), updatedBy: staffId }).where(eq(templates.id, row.id));
      }
    }
    return label;
  }

  async setRule(productCode: string, input: RuleInput, staffId: string) {
    if (input.whenGroup === input.targetGroup) throw new BadRequestException('A rule cannot target its own group');
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const whenValue = (await this.valueIds(tx, productId, await this.groupId(tx, input.whenGroup))).get(input.whenValue);
      if (!whenValue) throw new NotFoundException(`Value "${input.whenValue}" not found in "${input.whenGroup}"`);
      const targetGroupId = await this.groupId(tx, input.targetGroup);
      const targetValues = await this.valueIds(tx, productId, targetGroupId);

      const codeById = new Map([...targetValues].map(([code, v]) => [v.id, code]));
      const beforeAllowed = await tx
        .select({ valueId: optionValueRuleAllowed.valueId })
        .from(optionValueRuleAllowed)
        .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
        .where(and(eq(optionValueRules.productId, productId), eq(optionValueRules.whenValueId, whenValue.id), eq(optionValueRules.targetGroupId, targetGroupId)));
      const before = beforeAllowed.length ? beforeAllowed.map((r) => codeById.get(r.valueId)).sort() : null;

      await tx
        .delete(optionValueRules)
        .where(and(eq(optionValueRules.productId, productId), eq(optionValueRules.whenValueId, whenValue.id), eq(optionValueRules.targetGroupId, targetGroupId)));

      if (input.allowed !== null) {
        if (input.allowed.length === 0) throw new BadRequestException('Allow at least one option, or remove the rule');
        const unknown = input.allowed.filter((code) => !targetValues.has(code));
        if (unknown.length) throw new BadRequestException(`Unknown options for "${input.targetGroup}": ${unknown.join(', ')}`);

        const [rule] = await tx
          .insert(optionValueRules)
          .values({ productId, whenValueId: whenValue.id, targetGroupId, createdBy: staffId, updatedBy: staffId })
          .returning({ id: optionValueRules.id });
        await tx
          .insert(optionValueRuleAllowed)
          .values(input.allowed.map((code) => ({ ruleId: rule!.id, valueId: targetValues.get(code)!.id })));
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.rule.set',
        target: `${productCode} · ${input.whenGroup} / ${input.whenValue} → ${input.targetGroup}`,
        summary: input.allowed === null ? 'Removed the rule (all options allowed)' : `Allowed ${input.allowed.join(', ')}`,
        changes: { before, after: input.allowed ? [...input.allowed].sort() : null },
      });
    });
  }

  // ---------------------------------------------------------------- option library

  /** Every group and option, and which products use each option. */
  async getLibrary() {
    const [groups, values, uses, quantities, tiers, packages, packageUses] = await Promise.all([
      this.db.select().from(optionGroups).orderBy(asc(optionGroups.sortOrder)),
      this.db.select().from(optionValues).orderBy(asc(optionValues.sortOrder)),
      this.db
        .select({ valueId: productOptionValues.valueId, name: products.name })
        .from(productOptionValues)
        .innerJoin(products, eq(products.id, productOptionValues.productId))
        .orderBy(asc(products.sortOrder)),
      this.db.select({ quantity: libraryQuantities.quantity }).from(libraryQuantities).orderBy(asc(libraryQuantities.quantity)),
      this.db
        .select({ quantity: productQuantityTiers.quantity, name: products.name })
        .from(productQuantityTiers)
        .innerJoin(products, eq(products.id, productQuantityTiers.productId))
        .orderBy(asc(products.sortOrder)),
      this.db.select().from(designServiceTiers).orderBy(asc(designServiceTiers.sortOrder)),
      this.db
        .select({ tierId: productDesignServices.tierId, name: products.name })
        .from(productDesignServices)
        .innerJoin(products, eq(products.id, productDesignServices.productId))
        .orderBy(asc(products.sortOrder)),
    ]);
    return {
      designServices: packages.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        features: p.features,
        designDays: p.designDays,
        revisions: p.revisions,
        sortOrder: p.sortOrder,
        usedBy: packageUses.filter((u) => u.tierId === p.id).map((u) => u.name),
      })),
      quantities: quantities.map(({ quantity }) => ({ quantity, usedBy: tiers.filter((t) => t.quantity === quantity).map((t) => t.name) })),
      groups: groups.map((g) => ({
        code: g.code,
        label: g.label,
        sortOrder: g.sortOrder,
        required: isRequiredGroup(g.code),
        values: values
          .filter((v) => v.groupId === g.id)
          .map((v) => ({
            code: v.code,
            label: v.label,
            description: v.description,
            sortOrder: v.sortOrder,
            attributes: v.attributes,
            usedBy: uses.filter((u) => u.valueId === v.id).map((u) => u.name),
          })),
      })),
    };
  }

  /** Adds an add-on group with its first option, listed before turnaround. */
  async createGroup(input: GroupInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const groups = await tx.select().from(optionGroups).orderBy(asc(optionGroups.sortOrder));
      const code = input.code ?? valueCodeFrom(input.label);
      if (groups.some((g) => g.code === code)) throw new BadRequestException(`A "${code}" group already exists.`);

      const turnaround = groups.find((g) => g.code === TURNAROUND_GROUP);
      const sortOrder = turnaround?.sortOrder ?? (groups.at(-1)?.sortOrder ?? 0) + 1;
      if (turnaround) await tx.update(optionGroups).set({ sortOrder: sortOrder + 1, updatedBy: staffId }).where(eq(optionGroups.id, turnaround.id));
      const [group] = await tx
        .insert(optionGroups)
        .values({ code, label: input.label, sortOrder, createdBy: staffId, updatedBy: staffId })
        .returning({ id: optionGroups.id });
      await tx.insert(optionValues).values({
        groupId: group!.id,
        code: valueCodeFrom(input.firstOption),
        label: input.firstOption,
        attributes: FIRST_OPTION_ATTRIBUTES[code] ?? {},
        sortOrder: 1,
        createdBy: staffId,
        updatedBy: staffId,
      });

      await this.audit.record(tx, staffId, {
        action: 'catalog.group.create',
        target: code,
        summary: `Added the ${input.label} group`,
        changes: { before: null, after: { code, label: input.label, firstOption: input.firstOption } },
      });
      return { code };
    });
  }

  async updateGroup(groupCode: string, label: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const groupId = await this.groupId(tx, groupCode);
      const [before] = await tx.select({ label: optionGroups.label }).from(optionGroups).where(eq(optionGroups.id, groupId));
      await tx.update(optionGroups).set({ label, updatedBy: staffId }).where(eq(optionGroups.id, groupId));
      await this.audit.record(tx, staffId, {
        action: 'catalog.group.update',
        target: groupCode,
        summary: `Renamed ${before!.label} to ${label}`,
        changes: { before: { label: before!.label }, after: { label } },
      });
    });
  }

  /** The products using an option, or any option of a group. */
  private async usedBy(db: Executor, where: ReturnType<typeof eq>): Promise<string[]> {
    const rows = await db
      .selectDistinct({ name: products.name })
      .from(productOptionValues)
      .innerJoin(products, eq(products.id, productOptionValues.productId))
      .where(where);
    return rows.map((r) => r.name);
  }

  /** Deletes an add-on group nothing uses, with its options. */
  async deleteGroup(groupCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const groupId = await this.groupId(tx, groupCode);
      if (isRequiredGroup(groupCode)) throw new BadRequestException('Size, paper, printed sides and turnaround are needed by every product. You can rename them instead.');
      const using = await this.usedBy(tx, eq(productOptionValues.groupId, groupId));
      if (using.length) throw new BadRequestException(`Used by ${using.join(', ')}. Remove it from those products first.`);

      const [group] = await tx.select({ label: optionGroups.label }).from(optionGroups).where(eq(optionGroups.id, groupId));
      await tx.delete(optionGroups).where(eq(optionGroups.id, groupId));
      const rest = await tx.select({ id: optionGroups.id }).from(optionGroups).orderBy(asc(optionGroups.sortOrder));
      for (const [index, row] of rest.entries()) {
        await tx.update(optionGroups).set({ sortOrder: index + 1, updatedBy: staffId }).where(eq(optionGroups.id, row.id));
      }
      await this.audit.record(tx, staffId, {
        action: 'catalog.group.delete',
        target: groupCode,
        summary: `Deleted the ${group!.label} group`,
        changes: { before: { code: groupCode, label: group!.label }, after: null },
      });
    });
  }

  /** Adds an option to the library, at the end of its group. Products choose whether to use it. */
  async createLibraryValue(groupCode: string, input: LibraryValueInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const groupId = await this.groupId(tx, groupCode);
      const rows = await tx.select({ code: optionValues.code }).from(optionValues).where(eq(optionValues.groupId, groupId));
      const existing = new Set(rows.map((r) => r.code));

      let code = input.code ?? valueCodeFrom(input.label);
      if (input.code) {
        if (existing.has(code)) throw new BadRequestException(`An option with the code "${code}" already exists`);
      } else {
        const stem = code;
        for (let n = 2; existing.has(code); n++) code = `${stem}_${n}`;
      }
      this.parseAttributes(groupCode, input.attributes);

      const [last] = await tx
        .select({ sortOrder: optionValues.sortOrder })
        .from(optionValues)
        .where(eq(optionValues.groupId, groupId))
        .orderBy(desc(optionValues.sortOrder))
        .limit(1);
      await tx.insert(optionValues).values({
        groupId,
        code,
        label: input.label,
        description: input.description ?? null,
        attributes: input.attributes,
        sortOrder: (last?.sortOrder ?? 0) + 1,
        createdBy: staffId,
        updatedBy: staffId,
      });
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.create',
        target: `${groupCode} / ${code}`,
        summary: `Added ${input.label} to the library`,
        changes: { before: null, after: { code, label: input.label, description: input.description ?? null, attributes: input.attributes } },
      });
      return { code };
    });
  }

  /** Edits an option for every product that uses it. */
  async updateLibraryValue(groupCode: string, valueCode: string, patch: LibraryValuePatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const groupId = await this.groupId(tx, groupCode);
      const [before] = await tx.select().from(optionValues).where(and(eq(optionValues.groupId, groupId), eq(optionValues.code, valueCode)));
      if (!before) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);
      if (patch.attributes) this.parseAttributes(groupCode, patch.attributes);

      await tx.update(optionValues).set({ ...patch, updatedBy: staffId }).where(eq(optionValues.id, before.id));
      const changed = (Object.keys(patch) as (keyof LibraryValuePatch)[]).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(before[k]));
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.update',
        target: `${groupCode} / ${valueCode}`,
        summary: `Changed ${changed.join(', ') || 'nothing'} of ${before.label}`,
        changes: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, patch[k]])) },
      });
    });
  }

  /** Deletes an option no product uses. */
  async deleteLibraryValue(groupCode: string, valueCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const groupId = await this.groupId(tx, groupCode);
      const [value] = await tx.select().from(optionValues).where(and(eq(optionValues.groupId, groupId), eq(optionValues.code, valueCode))).for('update');
      if (!value) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);
      const using = await this.usedBy(tx, eq(productOptionValues.valueId, value.id));
      if (using.length) throw new BadRequestException(`Used by ${using.join(', ')}. Remove it from those products first.`);

      await tx.delete(optionValues).where(eq(optionValues.id, value.id));
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.delete',
        target: `${groupCode} / ${valueCode}`,
        summary: `Deleted ${value.label}`,
        changes: { before: { code: value.code, label: value.label, description: value.description, attributes: value.attributes }, after: null },
      });
    });
  }

  async createLibraryQuantity(quantity: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [taken] = await tx.select().from(libraryQuantities).where(eq(libraryQuantities.quantity, quantity));
      if (taken) throw new BadRequestException(`${quantity.toLocaleString('en-US')} already exists.`);
      await tx.insert(libraryQuantities).values({ quantity, createdBy: staffId, updatedBy: staffId });
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.create',
        target: `library / ${quantity}`,
        summary: `Added quantity ${quantity} to the library`,
        changes: { before: null, after: { quantity } },
      });
    });
  }

  /** Changes the number on every product selling it; their prices and turnaround stay on it. */
  async updateLibraryQuantity(from: number, to: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(libraryQuantities).where(eq(libraryQuantities.quantity, from));
      if (!row) throw new NotFoundException(`Quantity ${from} not found`);
      if (from === to) return;
      const [taken] = await tx.select().from(libraryQuantities).where(eq(libraryQuantities.quantity, to));
      if (taken) throw new BadRequestException(`${to.toLocaleString('en-US')} already exists.`);

      await tx.update(libraryQuantities).set({ quantity: to, updatedBy: staffId }).where(eq(libraryQuantities.quantity, from));
      const using = await tx.select({ productId: productQuantityTiers.productId }).from(productQuantityTiers).where(eq(productQuantityTiers.quantity, to));
      for (const { productId } of using) await this.sortQuantityTiers(tx, productId, staffId);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.update',
        target: `library / ${from}`,
        summary: `Changed quantity ${from} to ${to}`,
        changes: { before: { quantity: from }, after: { quantity: to } },
      });
    });
  }

  /** Deletes a quantity no product sells. */
  async deleteLibraryQuantity(quantity: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(libraryQuantities).where(eq(libraryQuantities.quantity, quantity));
      if (!row) throw new NotFoundException(`Quantity ${quantity} not found`);
      const using = await tx
        .select({ name: products.name })
        .from(productQuantityTiers)
        .innerJoin(products, eq(products.id, productQuantityTiers.productId))
        .where(eq(productQuantityTiers.quantity, quantity));
      if (using.length) throw new BadRequestException(`Used by ${using.map((u) => u.name).join(', ')}. Remove it from those products first.`);

      await tx.delete(libraryQuantities).where(eq(libraryQuantities.quantity, quantity));
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.delete',
        target: `library / ${quantity}`,
        summary: `Deleted quantity ${quantity} from the library`,
        changes: { before: { quantity }, after: null },
      });
    });
  }

  /** A quantity set straight on a product joins the library. */
  private async ensureLibraryQuantity(tx: Tx, quantity: number, staffId: string) {
    await tx.insert(libraryQuantities).values({ quantity, createdBy: staffId, updatedBy: staffId }).onConflictDoNothing();
  }

  // ---------------------------------------------------------------- products

  /**
   * Adds a product, off the storefront until it is shown. With `copyFrom` it starts as a full copy of
   * that product: the options it uses, rules, quantities, prices, turnaround, templates and design
   * packages. Without it, it starts with no options picked from the library.
   */
  async createProduct(input: ProductInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const code = input.code ?? productCodeFrom(input.name);
      if (RESERVED_PRODUCT_CODES.includes(code)) throw new BadRequestException(`/${code} is already a page of the site. Choose another URL.`);
      const [taken] = await tx.select({ id: products.id }).from(products).where(eq(products.code, code));
      if (taken) throw new BadRequestException(`/${code} is already used by another product. Choose another URL.`);

      const [source] = input.copyFrom ? await tx.select().from(products).where(eq(products.code, input.copyFrom)) : [];
      if (input.copyFrom && !source) throw new NotFoundException(`Product "${input.copyFrom}" not found`);
      const [last] = await tx.select({ sortOrder: max(products.sortOrder) }).from(products);
      const [product] = await tx
        .insert(products)
        .values({
          code,
          name: input.name,
          description: input.description ?? null,
          ...(source ? { unitName: source.unitName, unitNamePlural: source.unitNamePlural } : unitNamesFrom(input.name)),
          ...(input.unitName ? { unitName: input.unitName } : {}),
          ...(input.unitNamePlural ? { unitNamePlural: input.unitNamePlural } : {}),
          sortOrder: (last?.sortOrder ?? 0) + 1,
          isActive: false,
          createdBy: staffId,
          updatedBy: staffId,
        })
        .returning({ id: products.id });
      if (source) await this.copyConfiguration(tx, source.id, product!.id, staffId);

      await this.audit.record(tx, staffId, {
        action: 'catalog.product.create',
        target: code,
        summary: input.copyFrom ? `Added ${input.name}, copied from ${input.copyFrom}` : `Added ${input.name} as a blank product`,
        changes: { before: null, after: { code, name: input.name, copyFrom: input.copyFrom ?? null } },
      });
      return { code };
    });
  }

  private async copyConfiguration(tx: Tx, sourceId: string, targetId: string, staffId: string) {
    const uses = await tx.select().from(productOptionValues).where(eq(productOptionValues.productId, sourceId));
    if (uses.length) await tx.insert(productOptionValues).values(uses.map((u) => ({ ...copyRow(u, staffId), productId: targetId })));

    const tiers = await tx.select().from(productQuantityTiers).where(eq(productQuantityTiers.productId, sourceId));
    const newTiers = await tx
      .insert(productQuantityTiers)
      .values(tiers.map((t) => ({ ...copyRow(t, staffId), productId: targetId })))
      .returning({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity });
    const tierId = new Map(tiers.map((t) => [t.id, newTiers.find((n) => n.quantity === t.quantity)!.id]));

    const prices = await tx.select().from(corePrices).where(inArray(corePrices.quantityTierId, [...tierId.keys()]));
    if (prices.length) {
      await tx.insert(corePrices).values(
        prices.map((p) => ({ ...copyRow(p, staffId), quantityTierId: tierId.get(p.quantityTierId)! })),
      );
    }

    const speeds = await tx.select().from(turnaroundOptions).where(inArray(turnaroundOptions.quantityTierId, [...tierId.keys()]));
    if (speeds.length) {
      await tx.insert(turnaroundOptions).values(
        speeds.map((c) => ({ ...copyRow(c, staffId), quantityTierId: tierId.get(c.quantityTierId)! })),
      );
    }

    const rules = await tx.select().from(optionValueRules).where(eq(optionValueRules.productId, sourceId));
    if (rules.length) {
      const newRules = await tx
        .insert(optionValueRules)
        .values(
          rules.map((r) => ({ ...copyRow(r, staffId), productId: targetId })),
        )
        .returning({ id: optionValueRules.id, whenValueId: optionValueRules.whenValueId, targetGroupId: optionValueRules.targetGroupId });
      const ruleId = new Map(
        rules.map((r) => [
          r.id,
          newRules.find((n) => n.whenValueId === r.whenValueId && n.targetGroupId === r.targetGroupId)!.id,
        ]),
      );
      const allowed = await tx.select().from(optionValueRuleAllowed).where(inArray(optionValueRuleAllowed.ruleId, [...ruleId.keys()]));
      if (allowed.length) {
        await tx.insert(optionValueRuleAllowed).values(allowed.map((a) => ({ ruleId: ruleId.get(a.ruleId)!, valueId: a.valueId })));
      }
    }

    const templateRows = await tx.select().from(templates).where(eq(templates.productId, sourceId));
    if (templateRows.length) await tx.insert(templates).values(templateRows.map((t) => ({ ...copyRow(t, staffId), productId: targetId })));
    const facets = await tx.select().from(templateFacets).where(eq(templateFacets.productId, sourceId));
    if (facets.length) await tx.insert(templateFacets).values(facets.map((f) => ({ ...copyRow(f, staffId), productId: targetId })));
    const packages = await tx.select().from(productDesignServices).where(eq(productDesignServices.productId, sourceId));
    if (packages.length) await tx.insert(productDesignServices).values(packages.map((p) => ({ ...copyRow(p, staffId), productId: targetId })));
  }

  private async assertAnotherProductIsLive(tx: Tx, productId: string) {
    const [other] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.isActive, true), ne(products.id, productId)))
      .limit(1);
    if (!other) throw new BadRequestException('At least one product must stay on the storefront. Show another product first.');
  }

  /** Edits a product. Its code stays: it is the URL search engines and open carts point to. */
  async updateProduct(productCode: string, patch: ProductPatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.code, productCode)).for('update');
      if (!before) throw new NotFoundException(`Product "${productCode}" not found`);
      if (patch.isActive === false && before.isActive) await this.assertAnotherProductIsLive(tx, before.id);

      await tx.update(products).set({ ...patch, updatedBy: staffId }).where(eq(products.id, before.id));
      await this.assertStorefrontStillWorks(tx, productCode);

      const changed = (Object.keys(patch) as (keyof ProductPatch)[]).filter((k) => patch[k] !== before[k]);
      await this.audit.record(tx, staffId, {
        action: 'catalog.product.update',
        target: productCode,
        summary: `Changed ${changed.join(', ') || 'nothing'} of ${before.name}`,
        changes: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, patch[k]])) },
      });
    });
  }

  /** Placed orders keep their own copy of what was ordered, so they are not affected. */
  async deleteProduct(productCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.code, productCode)).for('update');
      if (!product) throw new NotFoundException(`Product "${productCode}" not found`);
      if (product.isActive) await this.assertAnotherProductIsLive(tx, product.id);

      await tx.delete(products).where(eq(products.id, product.id));
      await this.audit.record(tx, staffId, {
        action: 'catalog.product.delete',
        target: productCode,
        summary: `Deleted ${product.name}`,
        changes: { before: { code: product.code, name: product.name, isActive: product.isActive }, after: null },
      });
    });
  }

  private async quantityTier(db: Executor, productId: string, quantity: number) {
    const [tier] = await db
      .select()
      .from(productQuantityTiers)
      .where(and(eq(productQuantityTiers.productId, productId), eq(productQuantityTiers.quantity, quantity)))
      .for('update');
    if (!tier) throw new NotFoundException(`Quantity ${quantity} not found`);
    return tier;
  }

  private async assertQuantityIsNew(db: Executor, productId: string, quantity: number) {
    const [taken] = await db
      .select({ id: productQuantityTiers.id })
      .from(productQuantityTiers)
      .where(and(eq(productQuantityTiers.productId, productId), eq(productQuantityTiers.quantity, quantity)));
    if (taken) throw new BadRequestException(`${quantity.toLocaleString('en-US')} already exists.`);
  }

  /** Quantities are always listed from smallest to largest. */
  private async sortQuantityTiers(tx: Tx, productId: string, staffId: string) {
    const tiers = await tx
      .select({ id: productQuantityTiers.id })
      .from(productQuantityTiers)
      .where(eq(productQuantityTiers.productId, productId))
      .orderBy(asc(productQuantityTiers.quantity));
    for (const [index, tier] of tiers.entries()) {
      await tx.update(productQuantityTiers).set({ sortOrder: index + 1, updatedBy: staffId }).where(eq(productQuantityTiers.id, tier.id));
    }
  }

  /**
   * Adds a quantity (the default, if it is the product's first). It starts with the turnaround of the closest
   * quantity, because every quantity needs a speed, and with no prices: it is not sold until they are entered on the Pricing page.
   */
  async createQuantity(productCode: string, quantity: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      await this.assertQuantityIsNew(tx, productId, quantity);
      const closest = await this.attachQuantity(tx, productId, quantity, staffId);
      await this.sortQuantityTiers(tx, productId, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.create',
        target: `${productCode} · quantity / ${quantity}`,
        summary: `Added quantity ${quantity}`,
        changes: { before: null, after: { quantity, turnaroundFrom: closest ?? null } },
      });
    });
  }

  /**
   * Saves the quantities a product sells in one go: new ones start as in `createQuantity`, those left out go
   * with their prices and turnaround, and the default falls back to the first active one when it was removed.
   */
  async setQuantities(productCode: string, input: ProductQuantitiesInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tiers = await tx.select().from(productQuantityTiers).where(eq(productQuantityTiers.productId, productId));
      const wanted = input.quantities.map((q) => q.quantity);
      if (new Set(wanted).size !== wanted.length) throw new BadRequestException('A quantity is listed twice');
      const known = wanted.length ? await tx.select().from(libraryQuantities).where(inArray(libraryQuantities.quantity, wanted)) : [];
      const unknown = wanted.filter((q) => !known.some((k) => k.quantity === q));
      if (unknown.length) throw new BadRequestException(`Add ${unknown.join(', ')} to the option library first.`);

      const isHidden = (quantity: number) => (input.quantities.find((q) => q.quantity === quantity)?.isActive ?? tiers.find((t) => t.quantity === quantity)?.isActive) === false;
      const keptDefault = tiers.find((t) => t.isDefault && wanted.includes(t.quantity) && !isHidden(t.quantity))?.quantity;
      const defaultQuantity = input.default ?? keptDefault ?? wanted.find((q) => !isHidden(q));
      if (defaultQuantity !== undefined && !wanted.includes(defaultQuantity)) throw new BadRequestException('The default must be one of the quantities');
      if (defaultQuantity !== undefined && isHidden(defaultQuantity)) throw new BadRequestException('The default quantity must be active. Choose another default first.');

      const removed = tiers.filter((t) => !wanted.includes(t.quantity));
      const added = wanted.filter((q) => !tiers.some((t) => t.quantity === q));
      await tx.update(productQuantityTiers).set({ isDefault: false, updatedBy: staffId }).where(eq(productQuantityTiers.productId, productId));
      if (removed.length) await tx.delete(productQuantityTiers).where(inArray(productQuantityTiers.id, removed.map((t) => t.id)));
      for (const quantity of added) await this.attachQuantity(tx, productId, quantity, staffId);
      await tx.update(productQuantityTiers).set({ isDefault: false, updatedBy: staffId }).where(eq(productQuantityTiers.productId, productId));
      for (const q of input.quantities) {
        await tx
          .update(productQuantityTiers)
          .set({ isDefault: q.quantity === defaultQuantity, ...(q.isActive === undefined ? {} : { isActive: q.isActive }), updatedBy: staffId })
          .where(and(eq(productQuantityTiers.productId, productId), eq(productQuantityTiers.quantity, q.quantity)));
      }

      await this.sortQuantityTiers(tx, productId, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.pick',
        target: `${productCode} · quantity`,
        summary: `Sells ${wanted.length} quantities: ${added.length} added, ${removed.length} removed`,
        changes: { before: tiers.map((t) => t.quantity).sort((a, b) => a - b), after: [...wanted].sort((a, b) => a - b), default: defaultQuantity ?? null },
      });
    });
  }

  /** Puts a quantity on a product; returns the quantity whose turnaround it copied. */
  private async attachQuantity(tx: Tx, productId: string, quantity: number, staffId: string): Promise<number | undefined> {
    await this.ensureLibraryQuantity(tx, quantity, staffId);
    const others = await tx
      .select({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity })
      .from(productQuantityTiers)
      .where(eq(productQuantityTiers.productId, productId))
      .orderBy(asc(productQuantityTiers.quantity));
    const closest = others.reduce<(typeof others)[number] | undefined>(
      (best, tier) => (!best || Math.abs(tier.quantity - quantity) < Math.abs(best.quantity - quantity) ? tier : best),
      undefined,
    );

    const [tier] = await tx
      .insert(productQuantityTiers)
      .values({ productId, quantity, isDefault: others.length === 0, createdBy: staffId, updatedBy: staffId })
      .returning({ id: productQuantityTiers.id });
    if (closest) {
      const cells = await tx.select().from(turnaroundOptions).where(eq(turnaroundOptions.quantityTierId, closest.id));
      if (cells.length) {
        await tx.insert(turnaroundOptions).values(
          cells.map((c) => ({
            optionValueId: c.optionValueId,
            quantityTierId: tier!.id,
            minBusinessDays: c.minBusinessDays,
            businessDays: c.businessDays,
            pricePercent: c.pricePercent,
            createdBy: staffId,
            updatedBy: staffId,
          })),
        );
      }
    }
    return closest?.quantity;
  }

  /** Changes the number of a quantity; its prices and turnaround stay on it. */
  async updateQuantity(productCode: string, from: number, to: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tier = await this.quantityTier(tx, productId, from);
      if (from === to) return;
      await this.assertQuantityIsNew(tx, productId, to);
      await this.ensureLibraryQuantity(tx, to, staffId);

      await tx.update(productQuantityTiers).set({ quantity: to, updatedBy: staffId }).where(eq(productQuantityTiers.id, tier.id));
      await this.sortQuantityTiers(tx, productId, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.update',
        target: `${productCode} · quantity / ${from}`,
        summary: `Changed quantity ${from} to ${to}`,
        changes: { before: { quantity: from }, after: { quantity: to } },
      });
    });
  }

  async deleteQuantity(productCode: string, quantity: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tier = await this.quantityTier(tx, productId, quantity);
      if (tier.isDefault) throw new BadRequestException('This is the default quantity. Make another quantity the default before deleting it.');

      await tx.delete(productQuantityTiers).where(eq(productQuantityTiers.id, tier.id));
      await this.sortQuantityTiers(tx, productId, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.delete',
        target: `${productCode} · quantity / ${quantity}`,
        summary: `Deleted quantity ${quantity}`,
        changes: { before: { quantity, isActive: tier.isActive }, after: null },
      });
    });
  }

  async updatePricing(productCode: string, input: PricingInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tiersBefore = await tx
        .select({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity, isActive: productQuantityTiers.isActive, isDefault: productQuantityTiers.isDefault })
        .from(productQuantityTiers)
        .where(eq(productQuantityTiers.productId, productId));
      const tierByQty = new Map(tiersBefore.map((t) => [t.quantity, t.id]));

      for (const tier of input.tiers ?? []) {
        const id = tierByQty.get(tier.quantity);
        if (!id) throw new BadRequestException(`Quantity tier ${tier.quantity} does not exist`);
        if (tier.isDefault) {
          await tx
            .update(productQuantityTiers)
            .set({ isDefault: false, updatedBy: staffId })
            .where(and(eq(productQuantityTiers.productId, productId), ne(productQuantityTiers.id, id)));
        }
        const { quantity: _quantity, ...changes } = tier;
        await tx.update(productQuantityTiers).set({ ...changes, updatedBy: staffId }).where(eq(productQuantityTiers.id, id));
      }

      const valueRows = await tx
        .select({ id: optionValues.id, code: optionValues.code, group: optionGroups.code, addonPercent: productOptionValues.addonPercent })
        .from(productOptionValues)
        .innerJoin(optionValues, eq(optionValues.id, productOptionValues.valueId))
        .innerJoin(optionGroups, eq(optionGroups.id, productOptionValues.groupId))
        .where(eq(productOptionValues.productId, productId));
      const valueOf = (group: string, code: string) => {
        const value = valueRows.find((v) => v.group === group && v.code === code);
        if (!value) throw new BadRequestException(`Option "${group}.${code}" does not exist`);
        return value;
      };

      const coreChanges: { key: string; before: number | null; after: number | null }[] = [];
      for (const cell of input.corePrices ?? []) {
        const quantityTierId = tierByQty.get(cell.quantity);
        if (!quantityTierId) throw new BadRequestException(`Quantity tier ${cell.quantity} does not exist`);
        const key = {
          sizeValueId: valueOf(SIZE_GROUP, cell.size).id,
          paperValueId: valueOf(PAPER_GROUP, cell.paper).id,
          printedSideValueId: valueOf(PRINTED_SIDE_GROUP, cell.printedSide).id,
          quantityTierId,
        };
        const where = and(
          eq(corePrices.sizeValueId, key.sizeValueId),
          eq(corePrices.paperValueId, key.paperValueId),
          eq(corePrices.printedSideValueId, key.printedSideValueId),
          eq(corePrices.quantityTierId, quantityTierId),
        );
        const [old] = await tx.select({ cents: corePrices.priceCents }).from(corePrices).where(where);
        coreChanges.push({ key: `${cell.size} / ${cell.paper} / ${cell.printedSide} @ ${cell.quantity}`, before: old?.cents ?? null, after: cell.priceCents });
        if (cell.priceCents === null) {
          await tx.delete(corePrices).where(where);
        } else {
          await tx
            .insert(corePrices)
            .values({ ...key, priceCents: cell.priceCents, createdBy: staffId, updatedBy: staffId })
            .onConflictDoUpdate({
              target: [corePrices.sizeValueId, corePrices.paperValueId, corePrices.printedSideValueId, corePrices.quantityTierId],
              set: { priceCents: cell.priceCents, updatedBy: staffId, updatedAt: new Date() },
            });
        }
      }

      const addonChanges: { key: string; before: number; after: number }[] = [];
      for (const addon of input.addons ?? []) {
        if (isCoreGroup(addon.group)) throw new BadRequestException('Size, paper and printed sides have set prices, not a percent.');
        if (addon.group === TURNAROUND_GROUP) throw new BadRequestException('Turnaround is priced in the turnaround table.');
        const value = valueOf(addon.group, addon.value);
        addonChanges.push({ key: `${addon.group}.${addon.value}`, before: value.addonPercent, after: addon.percent });
        await tx
          .update(productOptionValues)
          .set({ addonPercent: addon.percent, updatedBy: staffId })
          .where(and(eq(productOptionValues.productId, productId), eq(productOptionValues.valueId, value.id)));
      }

      const [defaultTier] = await tx
        .select({ isActive: productQuantityTiers.isActive })
        .from(productQuantityTiers)
        .where(and(eq(productQuantityTiers.productId, productId), eq(productQuantityTiers.isDefault, true)));
      if (defaultTier && !defaultTier.isActive) {
        throw new BadRequestException('The default quantity must be active. Choose another default first.');
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      const tierChanges = (input.tiers ?? []).map((t) => {
        const { id: _id, ...before } = tiersBefore.find((b) => b.quantity === t.quantity)!;
        return { before, after: t };
      });
      const changedCore = coreChanges.filter((c) => c.before !== c.after);
      const changedAddons = addonChanges.filter((c) => c.before !== c.after);
      await this.audit.record(tx, staffId, {
        action: 'catalog.pricing.update',
        target: `${productCode} · pricing`,
        summary: `Updated ${tierChanges.length} quantity tier(s), ${changedCore.length} core price(s) and ${changedAddons.length} add-on(s)`,
        changes: { tiers: tierChanges, corePrices: changedCore, addons: changedAddons },
      });
    });
  }

  /**
   * Replaces the quantity × speed table of the product's turnaround group. Every cell sent is offered
   * with its days and percent; cells left out are not offered. Each active quantity must keep at least
   * one speed for the default options.
   */
  async setTurnarounds(productCode: string, cells: TurnaroundCell[], staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, TURNAROUND_GROUP);
      const values = await this.valueIds(tx, productId, groupId);
      const tiers = await tx
        .select({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity })
        .from(productQuantityTiers)
        .where(eq(productQuantityTiers.productId, productId));
      const tierByQty = new Map(tiers.map((t) => [t.quantity, t.id]));

      const keys = cells.map((c) => `${c.value}@${c.quantity}`);
      if (new Set(keys).size !== keys.length) throw new BadRequestException('A speed is listed twice for the same quantity');
      for (const cell of cells) {
        if (!values.has(cell.value)) throw new BadRequestException(`Turnaround "${cell.value}" does not exist`);
        if (!tierByQty.has(cell.quantity)) throw new BadRequestException(`Quantity tier ${cell.quantity} does not exist`);
      }

      const tierIds = tiers.map((t) => t.id);
      const valueIds = [...values.values()].map((v) => v.id);
      const codeById = new Map([...values].map(([code, v]) => [v.id, code]));
      const qtyById = new Map(tiers.map((t) => [t.id, t.quantity]));
      const beforeRows = valueIds.length
        ? await tx.select().from(turnaroundOptions).where(and(inArray(turnaroundOptions.optionValueId, valueIds), inArray(turnaroundOptions.quantityTierId, tierIds)))
        : [];
      const before = new Map(
        beforeRows.map((r) => [`${codeById.get(r.optionValueId)}@${qtyById.get(r.quantityTierId)}`, { minBusinessDays: r.minBusinessDays, businessDays: r.businessDays, percent: r.pricePercent }]),
      );

      if (valueIds.length) await tx.delete(turnaroundOptions).where(and(inArray(turnaroundOptions.optionValueId, valueIds), inArray(turnaroundOptions.quantityTierId, tierIds)));
      if (cells.length) {
        await tx.insert(turnaroundOptions).values(
          cells.map((c) => ({
            optionValueId: values.get(c.value)!.id,
            quantityTierId: tierByQty.get(c.quantity)!,
            minBusinessDays: c.minBusinessDays ?? c.businessDays,
            businessDays: c.businessDays,
            pricePercent: c.percent,
            createdBy: staffId,
            updatedBy: staffId,
          })),
        );
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      const after = new Map(cells.map((c) => [`${c.value}@${c.quantity}`, { minBusinessDays: c.minBusinessDays ?? c.businessDays, businessDays: c.businessDays, percent: c.percent }]));
      const changes = [...new Set([...before.keys(), ...after.keys()])]
        .map((key) => ({ key, before: before.get(key) ?? null, after: after.get(key) ?? null }))
        .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
      await this.audit.record(tx, staffId, {
        action: 'catalog.turnaround.update',
        target: `${productCode} · turnaround`,
        summary: `Updated ${changes.length} turnaround cell(s)`,
        changes: { cells: changes },
      });
    });
  }

  async updateTemplate(productCode: string, templateCode: string, patch: TemplatePatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const [before] = await tx
        .select({ name: templates.name, isActive: templates.isActive, tags: templates.tags })
        .from(templates)
        .where(and(eq(templates.productId, productId), eq(templates.code, templateCode)))
        .for('update');
      if (!before) throw new NotFoundException(`Template "${templateCode}" not found`);

      let tags: Record<string, string[]> | undefined;
      if (patch.tags) {
        const facets = await tx.select().from(templateFacets).where(eq(templateFacets.productId, productId));
        tags = {};
        for (const [facetCode, codes] of Object.entries(patch.tags)) {
          const facet = facets.find((f) => f.code === facetCode);
          if (!facet) throw new BadRequestException(`Unknown filter "${facetCode}"`);
          const unknown = codes.filter((c) => !facet.values.some((v) => v.code === c));
          if (unknown.length) throw new BadRequestException(`${facet.name} has no value ${unknown.join(', ')}`);
          if (codes.length) tags[facetCode] = [...new Set(codes)];
        }
      }

      await tx
        .update(templates)
        .set({ ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}), ...(tags ? { tags } : {}), updatedBy: staffId })
        .where(and(eq(templates.productId, productId), eq(templates.code, templateCode)));
      const summary =
        patch.isActive !== undefined && patch.isActive !== before.isActive
          ? `${patch.isActive ? 'Showed' : 'Hid'} the ${before.name} template`
          : `Updated the filters of the ${before.name} template`;
      await this.audit.record(tx, staffId, {
        action: 'catalog.template.update',
        target: `${productCode} · template ${templateCode}`,
        summary,
        changes: { before: { isActive: before.isActive, tags: before.tags }, after: patch },
      });
    });
  }

  /** Replaces the template filters (Industry, Style…). Values no longer offered are removed from templates. */
  async setFacets(productCode: string, facets: FacetInput[], staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const before = await tx.select().from(templateFacets).where(eq(templateFacets.productId, productId)).orderBy(asc(templateFacets.sortOrder));
      const codes = facets.map((f) => f.code);
      if (new Set(codes).size !== codes.length) throw new BadRequestException('Two filters have the same code');
      for (const facet of facets) {
        const valueCodes = facet.values.map((v) => v.code);
        if (new Set(valueCodes).size !== valueCodes.length) throw new BadRequestException(`${facet.name} has two values with the same code`);
      }

      const removed = before.filter((f) => !codes.includes(f.code)).map((f) => f.code);
      if (removed.length) await tx.delete(templateFacets).where(and(eq(templateFacets.productId, productId), inArray(templateFacets.code, removed)));
      for (const [index, facet] of facets.entries()) {
        const values = { name: facet.name, sortOrder: index + 1, values: facet.values, updatedBy: staffId };
        await tx
          .insert(templateFacets)
          .values({ productId, code: facet.code, ...values, createdBy: staffId })
          .onConflictDoUpdate({ target: [templateFacets.productId, templateFacets.code], set: values });
      }

      // Templates keep only tags that still exist.
      const rows = await tx.select({ id: templates.id, tags: templates.tags }).from(templates).where(eq(templates.productId, productId));
      for (const row of rows) {
        const kept = Object.fromEntries(
          Object.entries(row.tags)
            .map(([facetCode, values]) => {
              const facet = facets.find((f) => f.code === facetCode);
              return [facetCode, facet ? values.filter((v) => facet.values.some((fv) => fv.code === v)) : []] as const;
            })
            .filter(([, values]) => values.length > 0),
        );
        if (JSON.stringify(kept) !== JSON.stringify(row.tags)) await tx.update(templates).set({ tags: kept, updatedBy: staffId }).where(eq(templates.id, row.id));
      }

      await this.audit.record(tx, staffId, {
        action: 'catalog.template_filters.update',
        target: `${productCode} · template filters`,
        summary: `Updated template filters: ${facets.map((f) => `${f.name} (${f.values.length})`).join(', ') || 'none'}`,
        changes: { before: before.map((f) => ({ code: f.code, name: f.name, values: f.values })), after: facets },
      });
    });
  }

  /** Adds a "let us design it" package to the library, at the end. Products choose whether to offer it. */
  async createDesignTier(input: DesignTierInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({ code: designServiceTiers.code, sortOrder: designServiceTiers.sortOrder }).from(designServiceTiers);
      const taken = new Set(rows.map((r) => r.code));
      let code = input.code ?? valueCodeFrom(input.name);
      if (input.code) {
        if (taken.has(code)) throw new BadRequestException(`A package with the code "${code}" already exists`);
      } else {
        const stem = code;
        for (let n = 2; taken.has(code); n++) code = `${stem}_${n}`;
      }
      const { code: _code, ...fields } = input;
      await tx.insert(designServiceTiers).values({
        code,
        ...fields,
        sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1,
        createdBy: staffId,
        updatedBy: staffId,
      });
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.create',
        target: `design service ${code}`,
        summary: `Added the ${input.name} design service to the library`,
        changes: { before: null, after: { code, ...fields } },
      });
      return { code };
    });
  }

  /** Deletes a package no product offers. */
  async deleteDesignTier(tierCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [tier] = await tx.select().from(designServiceTiers).where(eq(designServiceTiers.code, tierCode)).for('update');
      if (!tier) throw new NotFoundException(`Design service "${tierCode}" not found`);
      const using = await tx
        .select({ name: products.name })
        .from(productDesignServices)
        .innerJoin(products, eq(products.id, productDesignServices.productId))
        .where(eq(productDesignServices.tierId, tier.id));
      if (using.length) throw new BadRequestException(`Used by ${using.map((u) => u.name).join(', ')}. Remove it from those products first.`);

      await tx.delete(designServiceTiers).where(eq(designServiceTiers.id, tier.id));
      const { id: _id, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...kept } = tier;
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.delete',
        target: `design service ${tierCode}`,
        summary: `Deleted the ${tier.name} design service`,
        changes: { before: kept, after: null },
      });
    });
  }

  /** Edits a package for every product offering it. Their own names and prices stay. */
  async updateDesignTier(tierCode: string, patch: DesignTierPatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(designServiceTiers).where(eq(designServiceTiers.code, tierCode)).for('update');
      if (!before) throw new NotFoundException(`Design service "${tierCode}" not found`);
      await tx.update(designServiceTiers).set({ ...patch, updatedBy: staffId }).where(eq(designServiceTiers.id, before.id));
      const changed = Object.keys(patch) as (keyof DesignTierPatch)[];
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.update',
        target: `design service ${tierCode}`,
        summary: `Updated the ${patch.name ?? before.name} design service`,
        changes: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: patch },
      });
    });
  }

  /** Saves the packages a product offers in one go. Carts holding one left out ask the customer to choose again; placed orders keep their copy. */
  async setDesignServices(productCode: string, input: ProductDesignServicesInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const codes = input.services.map((s) => s.code);
      if (new Set(codes).size !== codes.length) throw new BadRequestException('A package is listed twice');
      const tiers = codes.length ? await tx.select().from(designServiceTiers).where(inArray(designServiceTiers.code, codes)) : [];
      const unknown = codes.filter((code) => !tiers.some((t) => t.code === code));
      if (unknown.length) throw new BadRequestException(`Design service "${unknown[0]}" not found`);

      const before = await tx.select().from(productDesignServices).where(eq(productDesignServices.productId, productId));
      await tx.delete(productDesignServices).where(eq(productDesignServices.productId, productId));
      if (input.services.length) {
        await tx.insert(productDesignServices).values(
          input.services.map((s) => ({
            productId,
            tierId: tiers.find((t) => t.code === s.code)!.id,
            displayName: s.displayName?.trim() || null,
            priceCents: s.priceCents,
            isActive: s.isActive ?? true,
            createdBy: staffId,
            updatedBy: staffId,
          })),
        );
      }
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.pick',
        target: `${productCode} · design services`,
        summary: `Offers ${input.services.length} design service(s)`,
        changes: { before: before.map(({ tierId, displayName, priceCents, isActive }) => ({ tierId, displayName, priceCents, isActive })), after: input.services },
      });
    });
  }
}
