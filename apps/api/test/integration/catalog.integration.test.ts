/**
 * Checks that the catalog loaded from the real database (seeded by packages/db migrations)
 * matches the fixture used by the @printing/pricing unit tests, so the two cannot drift apart.
 * Requires DATABASE_URL pointing at a migrated database.
 */
import { createDb } from '@printing/db';
import type { Catalog } from '@printing/pricing';
import { afterAll, describe, expect, it } from 'vitest';
import { businessCards } from '../../../../packages/pricing/test/fixtures/business-cards.js';
import { CatalogService } from '../../src/catalog/catalog.service.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for integration tests');

const { db, pool } = createDb(url, { max: 2 });
const service = new CatalogService(db);

afterAll(async () => {
  await pool.end();
});

/** Fields that drive rules and prices. Labels and descriptions are display-only. */
function pricingShape(catalog: Catalog) {
  return {
    groups: catalog.groups.map((g) => ({
      code: g.code,
      sortOrder: g.sortOrder,
      values: g.values.map((v) => ({ code: v.code, sortOrder: v.sortOrder, isDefault: v.isDefault })),
    })),
    rules: [...catalog.rules]
      .map((r) => ({ ...r, allowed: [...r.allowed] }))
      .sort((a, b) => `${a.whenGroup}.${a.whenValue}.${a.targetGroup}`.localeCompare(`${b.whenGroup}.${b.whenValue}.${b.targetGroup}`)),
    quantityTiers: catalog.quantityTiers,
    upcharges: [...catalog.upcharges].sort((a, b) =>
      `${a.group}.${a.value}.${String(a.quantity).padStart(6, '0')}`.localeCompare(
        `${b.group}.${b.value}.${String(b.quantity).padStart(6, '0')}`,
      ),
    ),
  };
}

function attributesOf(catalog: Catalog, group: string) {
  return Object.fromEntries(catalog.groups.find((g) => g.code === group)!.values.map((v) => [v.code, v.attributes]));
}

describe('CatalogService.loadCatalog (real DB)', () => {
  it('matches the pricing fixture: groups, defaults, rules, tiers, upcharges', async () => {
    const catalog = await service.loadCatalog('business-cards');
    expect(pricingShape(catalog)).toEqual(pricingShape(businessCards));
  });

  it('size and paper attributes match the fixture exactly', async () => {
    const catalog = await service.loadCatalog('business-cards');
    expect(attributesOf(catalog, 'size')).toEqual(attributesOf(businessCards, 'size'));
    expect(attributesOf(catalog, 'paper')).toEqual(attributesOf(businessCards, 'paper'));
  });

  it('coating front/back finishes match the fixture', async () => {
    const catalog = await service.loadCatalog('business-cards');
    const finishes = (c: Catalog) =>
      c.groups
        .find((g) => g.code === 'coating')!
        .values.map((v) => [v.code, v.attributes.front, v.attributes.back]);
    expect(finishes(catalog)).toEqual(finishes(businessCards));
  });

  it('throws NotFound for an unknown product', async () => {
    await expect(service.loadCatalog('flyers')).rejects.toThrow('Product "flyers" not found');
  });
});
