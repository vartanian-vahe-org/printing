import { Inject, Injectable, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
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
import type { Redis } from 'ioredis';
import { DATABASE } from '../database/database.tokens.js';
import { REDIS } from '../redis/redis.tokens.js';

/** Catalog cache lifetime; admin edits clear it at once, so this only bounds a missed clear. */
const CACHE_SECONDS = 300;
const cacheKey = (productCode: string) => `catalog:v1:${productCode}`;

/**
 * Reads a product's configurator data from the DB in the shape @printing/pricing expects.
 * Only active values and quantity tiers are included, so whatever an admin hides disappears
 * from rules and prices too.
 */
@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    /** Absent when built by hand to read inside a transaction (admin checks): no cache then. */
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {}

  /**
   * The product's catalog, cached in Redis (open issue D2): every page view, cart and checkout reads
   * it, and it only changes when an admin edits options, rules or prices (which calls invalidate).
   * The cache is shared by every API instance; if Redis is down, the database is read directly.
   */
  async loadCatalog(productCode: string): Promise<Catalog> {
    if (!this.redis) return this.readCatalog(productCode);
    const cached = await this.redis.get(cacheKey(productCode)).catch(() => null);
    if (cached) return JSON.parse(cached) as Catalog;
    const catalog = await this.readCatalog(productCode);
    await this.redis.set(cacheKey(productCode), JSON.stringify(catalog), 'EX', CACHE_SECONDS).catch(() => undefined);
    return catalog;
  }

  /** Deploys run migrations that may change catalogs: start every API with a clean cache. */
  async onModuleInit() {
    if (!this.redis) return;
    const keys = await this.redis.keys(cacheKey('*')).catch(() => [] as string[]);
    if (keys.length) await this.redis.del(...keys).catch(() => undefined);
  }

  /** Call after any change to a product's options, rules or prices. */
  async invalidate(productCode: string): Promise<void> {
    await this.redis?.del(cacheKey(productCode));
  }

  private async readCatalog(productCode: string): Promise<Catalog> {
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
