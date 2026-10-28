import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Database,
  designServiceTiers,
  optionGroups,
  optionValuePrices,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
  productQuantityTiers,
  products,
  templateFacets,
  templates,
} from '@printing/db';
import { defaultQuantity, InvalidConfigurationError, quote, resolveSelection, SIZE_GROUP, UnsatisfiableSelectionError } from '@printing/pricing';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
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

export interface PricingInput {
  tiers?: { quantity: number; basePriceCents?: number; isActive?: boolean; isDefault?: boolean }[];
  upcharges?: { group: string; value: string; quantity: number; upchargeCents: number }[];
}

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

  /** Fails the transaction if the storefront could no longer show a priced default configuration. */
  private async assertStorefrontStillWorks(tx: Tx, productCode: string) {
    try {
      const catalog = await new CatalogService(tx as unknown as Database).loadCatalog(productCode);
      quote(catalog, { selection: resolveSelection(catalog, {}), quantity: defaultQuantity(catalog) });
    } catch (err) {
      if (err instanceof UnsatisfiableSelectionError) {
        throw new BadRequestException(`This change leaves "${err.groupCode}" with no available option. Allow at least one.`);
      }
      if (err instanceof InvalidConfigurationError) {
        throw new BadRequestException(`This change breaks the default configuration: ${err.issues.join('; ')}`);
      }
      if (err instanceof Error && err.message.includes('quantity tiers')) {
        throw new BadRequestException('At least one quantity tier must stay active.');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- read

  async listProducts() {
    const rows = await this.db
      .select({ code: products.code, name: products.name, isActive: products.isActive })
      .from(products)
      .orderBy(asc(products.name));
    return { products: rows };
  }

  async getCatalog(productCode: string) {
    const productId = await this.productId(this.db, productCode);
    const [product] = await this.db.select({ name: products.name }).from(products).where(eq(products.id, productId));
    const whenGroup = alias(optionGroups, 'when_group');
    const targetGroup = alias(optionGroups, 'target_group');
    const allowedValue = alias(optionValues, 'allowed_value');

    const [groups, values, rules, allowed, tiers, prices, templateRows, facetRows, designRows] = await Promise.all([
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
          group: optionGroups.code,
          value: optionValues.code,
          quantity: productQuantityTiers.quantity,
          upchargeCents: optionValuePrices.upchargeCents,
        })
        .from(optionValuePrices)
        .innerJoin(optionValues, eq(optionValues.id, optionValuePrices.optionValueId))
        .innerJoin(optionGroups, eq(optionGroups.id, optionValues.groupId))
        .innerJoin(productQuantityTiers, eq(productQuantityTiers.id, optionValuePrices.quantityTierId))
        .where(eq(optionGroups.productId, productId)),
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
        basePriceCents: t.basePriceCents,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
        isDefault: t.isDefault,
      })),
      upcharges: prices,
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

      if (patch.attributes) this.parseAttributes(groupCode, valueCode, patch.attributes);
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

  private parseAttributes(groupCode: string, valueCode: string, attributes: Record<string, unknown>) {
    const parsed = attributeSchema(groupCode, valueCode).safeParse(attributes);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid attributes',
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'attributes'}: ${i.message}`),
      });
    }
  }

  /**
   * Adds an option at the end of its group, active and not the default. With `copyFrom` it starts with
   * that option's upcharges and rules (and, for sizes, its templates); otherwise upcharges are $0, rules
   * that limit its group leave it out, and every template supports a new size (layouts adapt to any size).
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
      this.parseAttributes(groupCode, code, input.attributes);

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
        const prices = await tx.select().from(optionValuePrices).where(eq(optionValuePrices.optionValueId, source.id));
        if (prices.length) {
          await tx.insert(optionValuePrices).values(
            prices.map((p) => ({ optionValueId: id, quantityTierId: p.quantityTierId, upchargeCents: p.upchargeCents, createdBy: staffId, updatedBy: staffId })),
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
   * Deletes an option with its upcharges and rules. Carts holding it ask the customer to choose again;
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

      const prices = await tx
        .select({ quantity: productQuantityTiers.quantity, upchargeCents: optionValuePrices.upchargeCents })
        .from(optionValuePrices)
        .innerJoin(productQuantityTiers, eq(productQuantityTiers.id, optionValuePrices.quantityTierId))
        .where(eq(optionValuePrices.optionValueId, value.id));
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
          before: { code: value.code, label: value.label, description: value.description, isActive: value.isActive, attributes: value.attributes, upcharges: prices },
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

  async updatePricing(productCode: string, input: PricingInput, staffId: string) {
    await this.db.transaction(async (tx) => {
      const productId = await this.productId(tx, productCode);
      const tiers = await tx
        .select({ id: productQuantityTiers.id, quantity: productQuantityTiers.quantity })
        .from(productQuantityTiers)
        .where(eq(productQuantityTiers.productId, productId));
      const tierByQty = new Map(tiers.map((t) => [t.quantity, t.id]));
      const tiersBefore = await tx
        .select({ quantity: productQuantityTiers.quantity, basePriceCents: productQuantityTiers.basePriceCents, isActive: productQuantityTiers.isActive, isDefault: productQuantityTiers.isDefault })
        .from(productQuantityTiers)
        .where(eq(productQuantityTiers.productId, productId));
      const upchargesBefore = new Map<string, number>();

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

      if (input.upcharges?.length) {
        const groupCodes = [...new Set(input.upcharges.map((u) => u.group))];
        const valueRows = await tx
          .select({ id: optionValues.id, code: optionValues.code, group: optionGroups.code })
          .from(optionValues)
          .innerJoin(optionGroups, eq(optionGroups.id, optionValues.groupId))
          .where(and(eq(optionGroups.productId, productId), inArray(optionGroups.code, groupCodes)));
        const valueId = new Map(valueRows.map((v) => [`${v.group}.${v.code}`, v.id]));

        for (const u of input.upcharges) {
          const optionValueId = valueId.get(`${u.group}.${u.value}`);
          const quantityTierId = tierByQty.get(u.quantity);
          if (!optionValueId) throw new BadRequestException(`Option "${u.group}.${u.value}" does not exist`);
          if (!quantityTierId) throw new BadRequestException(`Quantity tier ${u.quantity} does not exist`);
          const [old] = await tx
            .select({ cents: optionValuePrices.upchargeCents })
            .from(optionValuePrices)
            .where(and(eq(optionValuePrices.optionValueId, optionValueId), eq(optionValuePrices.quantityTierId, quantityTierId)));
          upchargesBefore.set(`${u.group}.${u.value}@${u.quantity}`, old?.cents ?? 0);
          await tx
            .insert(optionValuePrices)
            .values({ optionValueId, quantityTierId, upchargeCents: u.upchargeCents, createdBy: staffId, updatedBy: staffId })
            .onConflictDoUpdate({
              target: [optionValuePrices.optionValueId, optionValuePrices.quantityTierId],
              set: { upchargeCents: u.upchargeCents, updatedBy: staffId, updatedAt: new Date() },
            });
        }
      }

      const [defaultTier] = await tx
        .select({ isActive: productQuantityTiers.isActive })
        .from(productQuantityTiers)
        .where(and(eq(productQuantityTiers.productId, productId), eq(productQuantityTiers.isDefault, true)));
      if (defaultTier && !defaultTier.isActive) {
        throw new BadRequestException('The default quantity must be active. Choose another default first.');
      }

      await this.assertStorefrontStillWorks(tx, productCode);
      const tierChanges = (input.tiers ?? []).map((t) => ({ before: tiersBefore.find((b) => b.quantity === t.quantity), after: t }));
      const upchargeChanges = (input.upcharges ?? [])
        .map((u) => ({ key: `${u.group}.${u.value}@${u.quantity}`, before: upchargesBefore.get(`${u.group}.${u.value}@${u.quantity}`), after: u.upchargeCents }))
        .filter((c) => c.before !== c.after);
      await this.audit.record(tx, staffId, {
        action: 'catalog.pricing.update',
        target: `${productCode} · pricing`,
        summary: `Updated ${tierChanges.length} quantity tier(s) and ${upchargeChanges.length} upcharge(s)`,
        changes: { tiers: tierChanges, upcharges: upchargeChanges },
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
