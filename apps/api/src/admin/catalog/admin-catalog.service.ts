import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  corePrices,
  type Database,
  designServiceTiers,
  optionGroups,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
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

export interface ValuePatch {
  label?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  isDefault?: boolean;
  attributes?: Record<string, unknown>;
}

export interface ValueInput {
  code?: string;
  label: string;
  description?: string | null;
  attributes: Record<string, unknown>;
  copyFrom?: string;
}

export interface ProductInput {
  code?: string;
  name: string;
  description?: string | null;
  /** Existing product whose whole configuration the new one starts with. */
  copyFrom: string;
}

export interface ProductPatch {
  name?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
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
  isActive?: boolean;
}

export interface DesignTierInput {
  code?: string;
  name: string;
  description: string | null;
  priceCents: number;
  features: string[];
  designDays: number;
  revisions: number | null;
  isActive?: boolean;
}

/** One offered cell of the quantity × speed table; cells left out are not offered. */
export interface TurnaroundCell {
  value: string;
  quantity: number;
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

  private async groupId(db: Executor, productId: string, code: string): Promise<string> {
    const [row] = await db
      .select({ id: optionGroups.id })
      .from(optionGroups)
      .where(and(eq(optionGroups.productId, productId), eq(optionGroups.code, code)))
      .limit(1);
    if (!row) throw new NotFoundException(`Option group "${code}" not found`);
    return row.id;
  }

  private async valueIds(db: Executor, groupId: string): Promise<Map<string, { id: string; isActive: boolean; isDefault: boolean }>> {
    const rows = await db
      .select({ id: optionValues.id, code: optionValues.code, isActive: optionValues.isActive, isDefault: optionValues.isDefault })
      .from(optionValues)
      .where(eq(optionValues.groupId, groupId));
    return new Map(rows.map((r) => [r.code, r]));
  }

  /**
   * Fails the transaction if the storefront could no longer open: the default options need a price at
   * the default quantity, and each quantity at least one turnaround speed.
   */
  private async assertStorefrontStillWorks(tx: Tx, productCode: string) {
    let quantity: number | null = null;
    try {
      const catalog = await new CatalogService(tx as unknown as Database).readCatalog(productCode, { includeHidden: true });
      const tiers = sortedTiers(catalog);
      if (tiers.length === 0) throw new BadRequestException('At least one quantity tier must stay active.');
      for (const tier of tiers) {
        quantity = tier.quantity;
        const selection = resolveSelection(catalog, {}, tier.quantity);
        if (corePriceAt(catalog, selection, tier.quantity)) quote(catalog, { selection, quantity: tier.quantity });
        else if (tier.isDefault) throw new BadRequestException(`The default options need a price at the default quantity (${tier.quantity.toLocaleString('en-US')}).`);
      }
    } catch (err) {
      if (err instanceof UnsatisfiableSelectionError) {
        if (err.groupCode === TURNAROUND_GROUP && quantity !== null) {
          throw new BadRequestException(`No turnaround would be offered for ${quantity.toLocaleString('en-US')} cards. Offer at least one speed at every quantity.`);
        }
        throw new BadRequestException(`This change leaves "${err.groupCode}" with no available option. Allow at least one.`);
      }
      if (err instanceof InvalidConfigurationError) {
        throw new BadRequestException(`This change breaks the default configuration: ${err.issues.join('; ')}`);
      }
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
        sortOrder: products.sortOrder,
        isActive: products.isActive,
      })
      .from(products)
      .orderBy(asc(products.sortOrder), asc(products.name));
    return { products: rows };
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
      this.db.select().from(optionGroups).where(eq(optionGroups.productId, productId)).orderBy(asc(optionGroups.sortOrder)),
      this.db
        .select({ value: optionValues, groupCode: optionGroups.code })
        .from(optionValues)
        .innerJoin(optionGroups, eq(optionGroups.id, optionValues.groupId))
        .where(eq(optionGroups.productId, productId))
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
          businessDays: turnaroundOptions.businessDays,
          percent: turnaroundOptions.pricePercent,
        })
        .from(turnaroundOptions)
        .innerJoin(optionValues, eq(optionValues.id, turnaroundOptions.optionValueId))
        .innerJoin(productQuantityTiers, eq(productQuantityTiers.id, turnaroundOptions.quantityTierId))
        .where(eq(productQuantityTiers.productId, productId)),
      this.db.select().from(templates).where(eq(templates.productId, productId)).orderBy(asc(templates.sortOrder)),
      this.db.select().from(templateFacets).where(eq(templateFacets.productId, productId)).orderBy(asc(templateFacets.sortOrder)),
      this.db.select().from(designServiceTiers).where(eq(designServiceTiers.productId, productId)).orderBy(asc(designServiceTiers.sortOrder)),
    ]);

    return {
      product: { code: productCode, name: product!.name },
      groups: groups.map((g) => ({
        code: g.code,
        label: g.label,
        sortOrder: g.sortOrder,
        displayStyle: g.displayStyle,
        values: values
          .filter((v) => v.groupCode === g.code)
          .map(({ value: v }) => ({
            code: v.code,
            label: v.label,
            description: v.description,
            sortOrder: v.sortOrder,
            isActive: v.isActive,
            isDefault: v.isDefault,
            attributes: v.attributes,
            addonPercent: v.addonPercent,
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
      designServices: designRows.map((d) => ({
        code: d.code,
        name: d.name,
        description: d.description,
        priceCents: d.priceCents,
        features: d.features,
        designDays: d.designDays,
        revisions: d.revisions,
        sortOrder: d.sortOrder,
        isActive: d.isActive,
      })),
    };
  }

  // ---------------------------------------------------------------- writes

  async updateValue(productCode: string, groupCode: string, valueCode: string, patch: ValuePatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, productId, groupCode);
      const existing = (await this.valueIds(tx, groupId)).get(valueCode);
      if (!existing) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);

      if (patch.attributes) this.parseAttributes(groupCode, patch.attributes);
      const willBeActive = patch.isActive ?? existing.isActive;
      const willBeDefault = patch.isDefault ?? existing.isDefault;
      if (willBeDefault && !willBeActive) {
        throw new BadRequestException('The default option must be active. Choose another default before hiding this one.');
      }
      if (patch.isDefault === false && existing.isDefault) {
        throw new BadRequestException('Each option group needs a default. Make another option the default instead.');
      }

      const [before] = await tx
        .select({
          label: optionValues.label,
          description: optionValues.description,
          sortOrder: optionValues.sortOrder,
          isActive: optionValues.isActive,
          isDefault: optionValues.isDefault,
          attributes: optionValues.attributes,
        })
        .from(optionValues)
        .where(eq(optionValues.id, existing.id));
      if (patch.isDefault === true) {
        await tx
          .update(optionValues)
          .set({ isDefault: false, updatedBy: staffId })
          .where(and(eq(optionValues.groupId, groupId), ne(optionValues.code, valueCode)));
      }
      await tx
        .update(optionValues)
        .set({ ...patch, updatedBy: staffId })
        .where(and(eq(optionValues.groupId, groupId), eq(optionValues.code, valueCode)));

      await this.assertStorefrontStillWorks(tx, productCode);
      const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k as keyof ValuePatch]) !== JSON.stringify(before?.[k as keyof typeof before]));
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.update',
        target: `${productCode} · ${groupCode} / ${valueCode}`,
        summary: `Changed ${changed.join(', ') || 'nothing'} of ${before?.label ?? valueCode}`,
        changes: { before: Object.fromEntries(changed.map((k) => [k, before?.[k as keyof typeof before]])), after: Object.fromEntries(changed.map((k) => [k, patch[k as keyof ValuePatch]])) },
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
   * Adds an option at the end of its group, active and not the default. With `copyFrom` it starts with
   * that option's prices, turnaround days and rules (and, for sizes, its templates). Otherwise a new add-on
   * is 0%, a new core option is not sold until it has prices, a new turnaround speed is offered at no
   * quantity until set in the table, rules that limit its group leave it out, and every template supports
   * a new size (layouts adapt to any size).
   */
  async createValue(productCode: string, groupCode: string, input: ValueInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, productId, groupCode);
      const existing = await this.valueIds(tx, groupId);

      let code = input.code ?? valueCodeFrom(input.label);
      if (input.code) {
        if (existing.has(code)) throw new BadRequestException(`An option with the code "${code}" already exists`);
      } else {
        const stem = code;
        for (let n = 2; existing.has(code); n++) code = `${stem}_${n}`;
      }
      this.parseAttributes(groupCode, input.attributes);

      const source = input.copyFrom ? existing.get(input.copyFrom) : undefined;
      if (input.copyFrom && !source) throw new BadRequestException(`Option "${input.copyFrom}" not found in "${groupCode}"`);

      const [last] = await tx
        .select({ sortOrder: optionValues.sortOrder })
        .from(optionValues)
        .where(eq(optionValues.groupId, groupId))
        .orderBy(desc(optionValues.sortOrder))
        .limit(1);
      const [created] = await tx
        .insert(optionValues)
        .values({
          groupId,
          code,
          label: input.label,
          description: input.description ?? null,
          attributes: input.attributes,
          sortOrder: (last?.sortOrder ?? 0) + 1,
          createdBy: staffId,
          updatedBy: staffId,
        })
        .returning({ id: optionValues.id });
      const id = created!.id;

      if (source) {
        const [{ addonPercent } = { addonPercent: 0 }] = await tx
          .select({ addonPercent: optionValues.addonPercent })
          .from(optionValues)
          .where(eq(optionValues.id, source.id));
        await tx.update(optionValues).set({ addonPercent }).where(eq(optionValues.id, id));
        if (isCoreGroup(groupCode)) {
          const column = CORE_COLUMN[groupCode as keyof typeof CORE_COLUMN];
          const prices = await tx.select().from(corePrices).where(eq(corePrices[column], source.id));
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
        const cells = await tx.select().from(turnaroundOptions).where(eq(turnaroundOptions.optionValueId, source.id));
        if (cells.length) {
          await tx.insert(turnaroundOptions).values(
            cells.map((c) => ({ optionValueId: id, quantityTierId: c.quantityTierId, businessDays: c.businessDays, pricePercent: c.pricePercent, createdBy: staffId, updatedBy: staffId })),
          );
        }
        // Its own rules: "when the customer picks <source>, only … in group Y".
        const ownRules = await tx.select().from(optionValueRules).where(eq(optionValueRules.whenValueId, source.id));
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
          .where(eq(optionValueRuleAllowed.valueId, source.id));
        if (allowing.length) await tx.insert(optionValueRuleAllowed).values(allowing.map((a) => ({ ruleId: a.ruleId, valueId: id })));
      }

      if (groupCode === SIZE_GROUP) {
        const rows = await tx.select({ id: templates.id, sizes: templates.supportedSizeCodes }).from(templates).where(eq(templates.productId, productId));
        for (const row of rows) {
          if (input.copyFrom && !row.sizes.includes(input.copyFrom)) continue;
          await tx.update(templates).set({ supportedSizeCodes: [...row.sizes, code], updatedBy: staffId }).where(eq(templates.id, row.id));
        }
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.create',
        target: `${productCode} · ${groupCode} / ${code}`,
        summary: `Added ${input.label}${input.copyFrom ? ` (prices and rules copied from ${input.copyFrom})` : ''}`,
        changes: { before: null, after: { code, label: input.label, description: input.description ?? null, attributes: input.attributes, copyFrom: input.copyFrom ?? null } },
      });
      return { code };
    });
  }

  /**
   * Deletes an option with its prices and rules. Carts holding it ask the customer to choose again;
   * placed orders keep their own copy of the configuration. Refused for the default, and when a rule
   * would be left allowing nothing.
   */
  async deleteValue(productCode: string, groupCode: string, valueCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const groupId = await this.groupId(tx, productId, groupCode);
      const [value] = await tx
        .select()
        .from(optionValues)
        .where(and(eq(optionValues.groupId, groupId), eq(optionValues.code, valueCode)))
        .for('update');
      if (!value) throw new NotFoundException(`Value "${valueCode}" not found in "${groupCode}"`);
      if (value.isDefault) throw new BadRequestException('This is the default option. Make another option the default before deleting it.');

      // Rules whose only allowed option is this one would leave customers nothing to pick.
      const restricting = await tx
        .select({ ruleId: optionValueRuleAllowed.ruleId, valueId: optionValueRuleAllowed.valueId })
        .from(optionValueRuleAllowed)
        .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
        .where(eq(optionValueRules.targetGroupId, groupId));
      const onlyHere = [...new Set(restricting.filter((r) => r.valueId === value.id).map((r) => r.ruleId))].filter(
        (ruleId) => restricting.filter((r) => r.ruleId === ruleId).length === 1,
      );
      if (onlyHere.length) {
        const blockers = await tx
          .select({ label: optionValues.label })
          .from(optionValueRules)
          .innerJoin(optionValues, eq(optionValues.id, optionValueRules.whenValueId))
          .where(inArray(optionValueRules.id, onlyHere));
        throw new BadRequestException(
          `${value.label} is the only option allowed with ${blockers.map((b) => b.label).join(', ')}. Change that rule first.`,
        );
      }

      await tx.delete(optionValues).where(eq(optionValues.id, value.id));

      if (groupCode === SIZE_GROUP) {
        const rows = await tx.select({ id: templates.id, sizes: templates.supportedSizeCodes }).from(templates).where(eq(templates.productId, productId));
        for (const row of rows.filter((r) => r.sizes.includes(valueCode))) {
          await tx.update(templates).set({ supportedSizeCodes: row.sizes.filter((s) => s !== valueCode), updatedBy: staffId }).where(eq(templates.id, row.id));
        }
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.value.delete',
        target: `${productCode} · ${groupCode} / ${valueCode}`,
        summary: `Deleted ${value.label}`,
        changes: {
          before: { code: value.code, label: value.label, description: value.description, isActive: value.isActive, attributes: value.attributes, addonPercent: value.addonPercent },
          after: null,
        },
      });
    });
  }

  async setRule(productCode: string, input: RuleInput, staffId: string) {
    if (input.whenGroup === input.targetGroup) throw new BadRequestException('A rule cannot target its own group');
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const whenValue = (await this.valueIds(tx, await this.groupId(tx, productId, input.whenGroup))).get(input.whenValue);
      if (!whenValue) throw new NotFoundException(`Value "${input.whenValue}" not found in "${input.whenGroup}"`);
      const targetGroupId = await this.groupId(tx, productId, input.targetGroup);
      const targetValues = await this.valueIds(tx, targetGroupId);

      const codeById = new Map([...targetValues].map(([code, v]) => [v.id, code]));
      const beforeAllowed = await tx
        .select({ valueId: optionValueRuleAllowed.valueId })
        .from(optionValueRuleAllowed)
        .innerJoin(optionValueRules, eq(optionValueRules.id, optionValueRuleAllowed.ruleId))
        .where(and(eq(optionValueRules.whenValueId, whenValue.id), eq(optionValueRules.targetGroupId, targetGroupId)));
      const before = beforeAllowed.length ? beforeAllowed.map((r) => codeById.get(r.valueId)).sort() : null;

      await tx
        .delete(optionValueRules)
        .where(and(eq(optionValueRules.whenValueId, whenValue.id), eq(optionValueRules.targetGroupId, targetGroupId)));

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

  /**
   * Adds a product that starts as a full copy of another one: options, rules, quantities, prices,
   * turnaround, templates and design packages. It stays off the storefront until it is shown.
   */
  async createProduct(input: ProductInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const code = input.code ?? productCodeFrom(input.name);
      if (RESERVED_PRODUCT_CODES.includes(code)) throw new BadRequestException(`/${code} is already a page of the site. Choose another URL.`);
      const [taken] = await tx.select({ id: products.id }).from(products).where(eq(products.code, code));
      if (taken) throw new BadRequestException(`/${code} is already used by another product. Choose another URL.`);

      const sourceId = await this.productId(tx, input.copyFrom);
      const [last] = await tx.select({ sortOrder: max(products.sortOrder) }).from(products);
      const [product] = await tx
        .insert(products)
        .values({
          code,
          name: input.name,
          description: input.description ?? null,
          sortOrder: (last?.sortOrder ?? 0) + 1,
          isActive: false,
          createdBy: staffId,
          updatedBy: staffId,
        })
        .returning({ id: products.id });
      await this.copyConfiguration(tx, sourceId, product!.id, staffId);

      await this.assertStorefrontStillWorks(tx, code);
      await this.audit.record(tx, staffId, {
        action: 'catalog.product.create',
        target: code,
        summary: `Added ${input.name}, copied from ${input.copyFrom}`,
        changes: { before: null, after: { code, name: input.name, copyFrom: input.copyFrom } },
      });
      return { code };
    });
  }

  private async copyConfiguration(tx: Tx, sourceId: string, targetId: string, staffId: string) {
    const groups = await tx.select().from(optionGroups).where(eq(optionGroups.productId, sourceId));
    const newGroups = await tx
      .insert(optionGroups)
      .values(groups.map((g) => ({ ...copyRow(g, staffId), productId: targetId })))
      .returning({ id: optionGroups.id, code: optionGroups.code });
    const groupId = new Map(groups.map((g) => [g.id, newGroups.find((n) => n.code === g.code)!.id]));

    const values = await tx.select().from(optionValues).where(inArray(optionValues.groupId, [...groupId.keys()]));
    const newValues = await tx
      .insert(optionValues)
      .values(values.map((v) => ({ ...copyRow(v, staffId), groupId: groupId.get(v.groupId)! })))
      .returning({ id: optionValues.id, groupId: optionValues.groupId, code: optionValues.code });
    const valueId = new Map(values.map((v) => [v.id, newValues.find((n) => n.groupId === groupId.get(v.groupId) && n.code === v.code)!.id]));

    const tiers = await tx.select().from(productQuantityTiers).where(eq(productQuantityTiers.productId, sourceId));
    const newTiers = await tx
      .insert(productQuantityTiers)
      .values(tiers.map((t) => ({ ...copyRow(t, staffId), productId: targetId })))
      .returning({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity });
    const tierId = new Map(tiers.map((t) => [t.id, newTiers.find((n) => n.quantity === t.quantity)!.id]));

    const prices = await tx.select().from(corePrices).where(inArray(corePrices.quantityTierId, [...tierId.keys()]));
    if (prices.length) {
      await tx.insert(corePrices).values(
        prices.map((p) => ({
          ...copyRow(p, staffId),
          sizeValueId: valueId.get(p.sizeValueId)!,
          paperValueId: valueId.get(p.paperValueId)!,
          printedSideValueId: valueId.get(p.printedSideValueId)!,
          quantityTierId: tierId.get(p.quantityTierId)!,
        })),
      );
    }

    const speeds = await tx.select().from(turnaroundOptions).where(inArray(turnaroundOptions.quantityTierId, [...tierId.keys()]));
    if (speeds.length) {
      await tx.insert(turnaroundOptions).values(
        speeds.map((c) => ({
          ...copyRow(c, staffId),
          optionValueId: valueId.get(c.optionValueId)!,
          quantityTierId: tierId.get(c.quantityTierId)!,
        })),
      );
    }

    const rules = await tx.select().from(optionValueRules).where(eq(optionValueRules.productId, sourceId));
    if (rules.length) {
      const newRules = await tx
        .insert(optionValueRules)
        .values(
          rules.map((r) => ({
            ...copyRow(r, staffId),
            productId: targetId,
            whenValueId: valueId.get(r.whenValueId)!,
            targetGroupId: groupId.get(r.targetGroupId)!,
          })),
        )
        .returning({ id: optionValueRules.id, whenValueId: optionValueRules.whenValueId, targetGroupId: optionValueRules.targetGroupId });
      const ruleId = new Map(
        rules.map((r) => [
          r.id,
          newRules.find((n) => n.whenValueId === valueId.get(r.whenValueId) && n.targetGroupId === groupId.get(r.targetGroupId))!.id,
        ]),
      );
      const allowed = await tx.select().from(optionValueRuleAllowed).where(inArray(optionValueRuleAllowed.ruleId, [...ruleId.keys()]));
      if (allowed.length) {
        await tx.insert(optionValueRuleAllowed).values(allowed.map((a) => ({ ruleId: ruleId.get(a.ruleId)!, valueId: valueId.get(a.valueId)! })));
      }
    }

    const templateRows = await tx.select().from(templates).where(eq(templates.productId, sourceId));
    if (templateRows.length) await tx.insert(templates).values(templateRows.map((t) => ({ ...copyRow(t, staffId), productId: targetId })));
    const facets = await tx.select().from(templateFacets).where(eq(templateFacets.productId, sourceId));
    if (facets.length) await tx.insert(templateFacets).values(facets.map((f) => ({ ...copyRow(f, staffId), productId: targetId })));
    const packages = await tx.select().from(designServiceTiers).where(eq(designServiceTiers.productId, sourceId));
    if (packages.length) await tx.insert(designServiceTiers).values(packages.map((p) => ({ ...copyRow(p, staffId), productId: targetId })));
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
   * Adds a quantity. It starts with the turnaround of the closest quantity, because every quantity needs
   * a speed, and with no prices: it is not sold until they are entered on the Pricing page.
   */
  async createQuantity(productCode: string, quantity: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      await this.assertQuantityIsNew(tx, productId, quantity);

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
        .values({ productId, quantity, createdBy: staffId, updatedBy: staffId })
        .returning({ id: productQuantityTiers.id });
      if (closest) {
        const cells = await tx.select().from(turnaroundOptions).where(eq(turnaroundOptions.quantityTierId, closest.id));
        if (cells.length) {
          await tx.insert(turnaroundOptions).values(
            cells.map((c) => ({
              optionValueId: c.optionValueId,
              quantityTierId: tier!.id,
              businessDays: c.businessDays,
              pricePercent: c.pricePercent,
              createdBy: staffId,
              updatedBy: staffId,
            })),
          );
        }
      }

      await this.sortQuantityTiers(tx, productId, staffId);
      await this.assertStorefrontStillWorks(tx, productCode);
      await this.audit.record(tx, staffId, {
        action: 'catalog.quantity.create',
        target: `${productCode} · quantity / ${quantity}`,
        summary: `Added quantity ${quantity}`,
        changes: { before: null, after: { quantity, turnaroundFrom: closest?.quantity ?? null } },
      });
    });
  }

  /** Changes the number of a quantity; its prices and turnaround stay on it. */
  async updateQuantity(productCode: string, from: number, to: number, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tier = await this.quantityTier(tx, productId, from);
      if (from === to) return;
      await this.assertQuantityIsNew(tx, productId, to);

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
        .select({ id: optionValues.id, code: optionValues.code, group: optionGroups.code, addonPercent: optionValues.addonPercent })
        .from(optionValues)
        .innerJoin(optionGroups, eq(optionGroups.id, optionValues.groupId))
        .where(eq(optionGroups.productId, productId));
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
        await tx.update(optionValues).set({ addonPercent: addon.percent, updatedBy: staffId }).where(eq(optionValues.id, value.id));
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
      const groupId = await this.groupId(tx, productId, TURNAROUND_GROUP);
      const values = await this.valueIds(tx, groupId);
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

      const valueIds = [...values.values()].map((v) => v.id);
      const codeById = new Map([...values].map(([code, v]) => [v.id, code]));
      const qtyById = new Map(tiers.map((t) => [t.id, t.quantity]));
      const beforeRows = valueIds.length
        ? await tx.select().from(turnaroundOptions).where(inArray(turnaroundOptions.optionValueId, valueIds))
        : [];
      const before = new Map(
        beforeRows.map((r) => [`${codeById.get(r.optionValueId)}@${qtyById.get(r.quantityTierId)}`, { businessDays: r.businessDays, percent: r.pricePercent }]),
      );

      if (valueIds.length) await tx.delete(turnaroundOptions).where(inArray(turnaroundOptions.optionValueId, valueIds));
      if (cells.length) {
        await tx.insert(turnaroundOptions).values(
          cells.map((c) => ({
            optionValueId: values.get(c.value)!.id,
            quantityTierId: tierByQty.get(c.quantity)!,
            businessDays: c.businessDays,
            pricePercent: c.percent,
            createdBy: staffId,
            updatedBy: staffId,
          })),
        );
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      const after = new Map(cells.map((c) => [`${c.value}@${c.quantity}`, { businessDays: c.businessDays, percent: c.percent }]));
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

  /** Adds a "let us design it" package at the end of this product's list. Codes only need to be unique per product. */
  async createDesignTier(productCode: string, input: DesignTierInput, staffId: string): Promise<{ code: string }> {
    return this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const rows = await tx
        .select({ code: designServiceTiers.code, sortOrder: designServiceTiers.sortOrder })
        .from(designServiceTiers)
        .where(eq(designServiceTiers.productId, productId));
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
        productId,
        code,
        ...fields,
        sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1,
        createdBy: staffId,
        updatedBy: staffId,
      });
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.create',
        target: `${productCode} · design service ${code}`,
        summary: `Added the ${input.name} design service ($${(input.priceCents / 100).toFixed(2)})`,
        changes: { before: null, after: { code, ...fields } },
      });
      return { code };
    });
  }

  /** Deletes a package. Carts holding it ask the customer to choose again; placed orders keep their copy. */
  async deleteDesignTier(productCode: string, tierCode: string, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const [before] = await tx
        .delete(designServiceTiers)
        .where(and(eq(designServiceTiers.productId, productId), eq(designServiceTiers.code, tierCode)))
        .returning();
      if (!before) throw new NotFoundException(`Design service "${tierCode}" not found`);
      const { id: _id, productId: _p, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...kept } = before;
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.delete',
        target: `${productCode} · design service ${tierCode}`,
        summary: `Deleted the ${before.name} design service`,
        changes: { before: kept, after: null },
      });
    });
  }

  /** Edits a "let us design it" package (price, what it includes, turnaround, rounds of changes). */
  async updateDesignTier(productCode: string, tierCode: string, patch: DesignTierPatch, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const [before] = await tx
        .select()
        .from(designServiceTiers)
        .where(and(eq(designServiceTiers.productId, productId), eq(designServiceTiers.code, tierCode)))
        .for('update');
      if (!before) throw new NotFoundException(`Design service "${tierCode}" not found`);
      await tx.update(designServiceTiers).set({ ...patch, updatedBy: staffId }).where(eq(designServiceTiers.id, before.id));
      const changed = Object.keys(patch) as (keyof DesignTierPatch)[];
      await this.audit.record(tx, staffId, {
        action: 'catalog.design_service.update',
        target: `${productCode} · design service ${tierCode}`,
        summary:
          patch.priceCents !== undefined && patch.priceCents !== before.priceCents
            ? `${before.name} design service: price $${(before.priceCents / 100).toFixed(2)} → $${(patch.priceCents / 100).toFixed(2)}`
            : `Updated the ${patch.name ?? before.name} design service`,
        changes: { before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: patch },
      });
    });
  }
}
