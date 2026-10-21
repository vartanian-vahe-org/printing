import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Database,
  optionGroups,
  optionValuePrices,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
  productQuantityTiers,
  products,
} from '@printing/db';
import type { Catalog, OptionGroup } from '@printing/pricing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE } from '../database/database.tokens.js';

/**
 * Reads a product's configurator data from the DB in the shape @printing/pricing expects.
 * Only active values and quantity tiers are included, so whatever an admin hides disappears
 * from rules and prices too.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async loadCatalog(productCode: string): Promise<Catalog> {
    const [product] = await this.db
      .select({ id: products.id, code: products.code, name: products.name })
      .from(products)
      .where(and(eq(products.code, productCode), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundException(`Product "${productCode}" not found`);

    const [groupRows, valueRows, ruleRows, allowedRows, tierRows, priceRows] = await Promise.all([
      this.db
        .select()
        .from(optionGroups)
        .where(eq(optionGroups.productId, product.id))
        .orderBy(asc(optionGroups.sortOrder)),
      this.db
        .select({ value: optionValues, groupCode: optionGroups.code })
        .from(optionValues)
        .innerJoin(optionGroups, eq(optionGroups.id, optionValues.groupId))
        .where(and(eq(optionGroups.productId, product.id), eq(optionValues.isActive, true)))
        .orderBy(asc(optionValues.sortOrder)),
      this.loadRules(product.id),
      this.loadRuleAllowed(product.id),
      this.db
        .select()
        .from(productQuantityTiers)
        .where(and(eq(productQuantityTiers.productId, product.id), eq(productQuantityTiers.isActive, true)))
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
        .where(
          and(
            eq(optionGroups.productId, product.id),
            eq(optionValues.isActive, true),
            eq(productQuantityTiers.isActive, true),
          ),
        ),
    ]);

    const groups: OptionGroup[] = groupRows.map((g) => ({
      code: g.code,
      label: g.label,
      sortOrder: g.sortOrder,
      displayStyle: g.displayStyle as OptionGroup['displayStyle'],
      values: valueRows
        .filter((row) => row.groupCode === g.code)
        .map(({ value }) => ({
          code: value.code,
          label: value.label,
          description: value.description,
          sortOrder: value.sortOrder,
          isDefault: value.isDefault,
          attributes: value.attributes,
        })),
    }));

    const rules = ruleRows.map((rule) => ({
      whenGroup: rule.whenGroup,
      whenValue: rule.whenValue,
      targetGroup: rule.targetGroup,
      allowed: allowedRows.filter((a) => a.ruleId === rule.id).map((a) => a.value),
    }));

    return {
      product: { code: product.code, name: product.name },
      groups,
      rules,
      quantityTiers: tierRows.map((t) => ({
        quantity: t.quantity,
        basePriceCents: t.basePriceCents,
        sortOrder: t.sortOrder,
        isDefault: t.isDefault,
      })),
      upcharges: priceRows,
    };
  }

  /** Rules whose trigger value is active. */
  private loadRules(productId: string) {
    const whenGroup = alias(optionGroups, 'when_group');
    const targetGroup = alias(optionGroups, 'target_group');
    return this.db
      .select({
        id: optionValueRules.id,
        whenGroup: whenGroup.code,
        whenValue: optionValues.code,
        targetGroup: targetGroup.code,
      })
      .from(optionValueRules)
      .innerJoin(optionValues, eq(optionValues.id, optionValueRules.whenValueId))
      .innerJoin(whenGroup, eq(whenGroup.id, optionValues.groupId))
      .innerJoin(targetGroup, eq(targetGroup.id, optionValueRules.targetGroupId))
      .where(and(eq(optionValueRules.productId, productId), eq(optionValues.isActive, true)))
      .orderBy(asc(whenGroup.sortOrder), asc(optionValues.sortOrder), asc(targetGroup.sortOrder));
  }

  /** Allowed values of each rule, active values only, in sort order. */
  private async loadRuleAllowed(productId: string) {
    const ruleIds = this.db
      .select({ id: optionValueRules.id })
      .from(optionValueRules)
      .where(eq(optionValueRules.productId, productId));
    return this.db
      .select({ ruleId: optionValueRuleAllowed.ruleId, value: optionValues.code })
      .from(optionValueRuleAllowed)
      .innerJoin(optionValues, eq(optionValues.id, optionValueRuleAllowed.valueId))
      .where(and(inArray(optionValueRuleAllowed.ruleId, ruleIds), eq(optionValues.isActive, true)))
      .orderBy(asc(optionValues.sortOrder));
  }
}
