import { Inject, Injectable, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
  corePrices,
  type Database,
  optionGroups,
  optionValueRuleAllowed,
  optionValueRules,
  optionValues,
  productOptionValues,
  productQuantityTiers,
  products,
  turnaroundOptions,
} from '@printing/db';
import { CORE_GROUPS, TURNAROUND_GROUP, type Catalog, type OptionGroup } from '@printing/pricing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Redis } from 'ioredis';
import { DATABASE } from '../database/database.tokens.js';
import { REDIS } from '../redis/redis.tokens.js';

/** Catalog cache lifetime; admin edits clear it at once, so this only bounds a missed clear. */
const CACHE_SECONDS = 300;
const cacheKey = (productCode: string) => `catalog:v5:${productCode}`;

/** Groups every product has, even before any of their options is picked. */
const REQUIRED_GROUPS: string[] = [...CORE_GROUPS, TURNAROUND_GROUP];

/**
 * Reads a product's configurator data from the DB in the shape @printing/pricing expects.
 * Only the library options the product uses and has not hidden are included, and active quantity
 * tiers, so whatever an admin hides disappears from rules and prices too.
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

  /** Call after a change to the option library, which every product reads. */
  async invalidateAll(): Promise<void> {
    if (!this.redis) return;
    const keys = await this.redis.keys(cacheKey('*'));
    if (keys.length) await this.redis.del(...keys);
  }

  /** Products on the storefront, in display order. */
  async listProducts() {
    return this.db
      .select({
        code: products.code,
        name: products.name,
        description: products.description,
        seoTitle: products.seoTitle,
        seoDescription: products.seoDescription,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sortOrder), asc(products.name));
  }

  /** `includeHidden`: admin checks also read products that are not on the storefront yet. */
  async readCatalog(productCode: string, { includeHidden = false } = {}): Promise<Catalog> {
    const [product] = await this.db
      .select({ id: products.id, code: products.code, name: products.name, unitName: products.unitName, unitNamePlural: products.unitNamePlural })
      .from(products)
      .where(and(eq(products.code, productCode), includeHidden ? undefined : eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundException(`Product "${productCode}" not found`);

    const sizeValue = alias(optionValues, 'size_value');
    const paperValue = alias(optionValues, 'paper_value');
    const sideValue = alias(optionValues, 'side_value');

    const [groupRows, valueRows, ruleRows, allowedRows, tierRows, priceRows, turnaroundRows] = await Promise.all([
      this.db.select().from(optionGroups).orderBy(asc(optionGroups.sortOrder)),
      this.db
        .select({ value: optionValues, use: productOptionValues, groupCode: optionGroups.code })
        .from(productOptionValues)
        .innerJoin(optionValues, eq(optionValues.id, productOptionValues.valueId))
        .innerJoin(optionGroups, eq(optionGroups.id, productOptionValues.groupId))
        .where(and(eq(productOptionValues.productId, product.id), eq(productOptionValues.isActive, true)))
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
        .where(and(eq(productQuantityTiers.productId, product.id), eq(productQuantityTiers.isActive, true))),
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
        .where(and(eq(productQuantityTiers.productId, product.id), eq(productQuantityTiers.isActive, true))),
    ]);

    // The required groups (empty on a product still being set up), and the add-ons the product uses.
    const groups: OptionGroup[] = groupRows
      .filter((g) => REQUIRED_GROUPS.includes(g.code) || valueRows.some((row) => row.groupCode === g.code))
      .map((g) => ({
        code: g.code,
        label: g.label,
        sortOrder: g.sortOrder,
        displayStyle: g.displayStyle as OptionGroup['displayStyle'],
        values: valueRows
          .filter((row) => row.groupCode === g.code)
          .map(({ value, use }) => ({
            code: value.code,
            label: value.label,
            description: value.description,
            sortOrder: value.sortOrder,
            isDefault: use.isDefault,
            attributes: value.attributes,
            addonPercent: use.addonPercent,
          })),
      }));

    // Options the product does not use, or has hidden, disappear from its rules and prices too.
    const offered = (group: string) => new Set(groups.find((g) => g.code === group)?.values.map((v) => v.code));
    const [sizes, papers, sides, speeds] = [offered('size'), offered('paper'), offered('printed_side'), offered(TURNAROUND_GROUP)];

    const rules = ruleRows
      .filter((rule) => offered(rule.whenGroup).has(rule.whenValue))
      .map((rule) => ({
        whenGroup: rule.whenGroup,
        whenValue: rule.whenValue,
        targetGroup: rule.targetGroup,
        allowed: allowedRows.filter((a) => a.ruleId === rule.id && offered(rule.targetGroup).has(a.value)).map((a) => a.value),
      }));

    return {
      product: { code: product.code, name: product.name, unitName: product.unitName, unitNamePlural: product.unitNamePlural },
      groups,
      rules,
      quantityTiers: tierRows.map((t) => ({
        quantity: t.quantity,
        sortOrder: t.sortOrder,
        isDefault: t.isDefault,
      })),
      corePrices: priceRows.filter((p) => sizes.has(p.size) && papers.has(p.paper) && sides.has(p.printedSide)),
      turnarounds: turnaroundRows.filter((t) => speeds.has(t.value)),
    };
  }

  /** Rules of a product, in display order. */
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
      .where(eq(optionValueRules.productId, productId))
      .orderBy(asc(whenGroup.sortOrder), asc(optionValues.sortOrder), asc(targetGroup.sortOrder));
  }

  /** Allowed values of each rule, in sort order. */
  private async loadRuleAllowed(productId: string) {
    const ruleIds = this.db
      .select({ id: optionValueRules.id })
      .from(optionValueRules)
      .where(eq(optionValueRules.productId, productId));
    return this.db
      .select({ ruleId: optionValueRuleAllowed.ruleId, value: optionValues.code })
      .from(optionValueRuleAllowed)
      .innerJoin(optionValues, eq(optionValues.id, optionValueRuleAllowed.valueId))
      .where(inArray(optionValueRuleAllowed.ruleId, ruleIds))
      .orderBy(asc(optionValues.sortOrder));
  }
}
