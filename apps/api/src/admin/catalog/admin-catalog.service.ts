import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Database,
  optionGroups,
  optionValuePrices,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
  productQuantityTiers,
  products,
  templates,
} from '@printing/db';
import { defaultQuantity, InvalidConfigurationError, quote, resolveSelection, UnsatisfiableSelectionError } from '@printing/pricing';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CatalogService } from '../../catalog/catalog.service.js';
import { DATABASE } from '../../database/database.tokens.js';
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

export interface RuleInput {
  whenGroup: string;
  whenValue: string;
  targetGroup: string;
  /** null removes the rule (no restriction). */
  allowed: string[] | null;
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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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

  async getCatalog(productCode: string) {
    const productId = await this.productId(this.db, productCode);
    const whenGroup = alias(optionGroups, 'when_group');
    const targetGroup = alias(optionGroups, 'target_group');
    const allowedValue = alias(optionValues, 'allowed_value');

    const [groups, values, rules, allowed, tiers, prices, templateRows] = await Promise.all([
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
    ]);

    return {
      product: { code: productCode },
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

      if (patch.attributes) {
        const parsed = attributeSchema(groupCode, valueCode).safeParse(patch.attributes);
        if (!parsed.success) {
          throw new BadRequestException({
            message: 'Invalid attributes',
            issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'attributes'}: ${i.message}`),
          });
        }
      }
      const willBeActive = patch.isActive ?? existing.isActive;
      const willBeDefault = patch.isDefault ?? existing.isDefault;
      if (willBeDefault && !willBeActive) {
        throw new BadRequestException('The default option must be active. Choose another default before hiding this one.');
      }
      if (patch.isDefault === false && existing.isDefault) {
        throw new BadRequestException('Each option group needs a default. Make another option the default instead.');
      }

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
    });
  }

  async updateTemplate(productCode: string, templateCode: string, patch: { isActive: boolean }, staffId: string) {
    const productId = await this.productId(this.db, productCode);
    const updated = await this.db
      .update(templates)
      .set({ isActive: patch.isActive, updatedBy: staffId })
      .where(and(eq(templates.productId, productId), eq(templates.code, templateCode)))
      .returning({ code: templates.code });
    if (updated.length === 0) throw new NotFoundException(`Template "${templateCode}" not found`);
  }
}
