/**
 * Templates in the real database (seeded by migration 0006, tagged by 0023) must match the seed source
 * packages/templates/seed/business-cards-templates.json, and every layout must render.
 * Requires DATABASE_URL pointing at a migrated database.
 */
import { createDb } from '@printing/db';
import { parseLayout, renderFace } from '@printing/templates';
import { afterAll, describe, expect, it } from 'vitest';
import seed from '../../../../packages/templates/seed/business-cards-templates.json' with { type: 'json' };
import { TemplatesService } from '../../src/templates/templates.service.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for integration tests');

const { db, pool } = createDb(url, { max: 2 });
const service = new TemplatesService(db);

afterAll(async () => {
  await pool.end();
});

describe('TemplatesService.listTemplates (real DB)', () => {
  it('returns the seeded templates in order, identical to the seed source', async () => {
    const templates = await service.listTemplates('business-cards');
    expect(templates).toEqual(
      seed.templates.map((t) => ({
        code: t.code,
        name: t.name,
        description: t.description,
        sortOrder: t.sortOrder,
        supportedSizeCodes: t.supportedSizeCodes,
        layout: parseLayout(t.layout),
        // Filter tags come from migration 0023 (and admin edits), not from the layout seed.
        tags: expect.any(Object),
      })),
    );
    for (const t of templates) expect(Object.keys(t.tags ?? {}).length).toBeGreaterThan(0);
  });

  it('every template renders both sides', async () => {
    const geometry = { widthIn: 3.5, heightIn: 2, bleedIn: 0.125, safeIn: 0.125 };
    for (const t of await service.listTemplates('business-cards')) {
      for (const side of ['front', 'back'] as const) {
        expect(renderFace({ layout: t.layout, side, values: {}, geometry }).warnings).toEqual([]);
      }
    }
  });

  it('throws NotFound for an unknown product', async () => {
    await expect(service.listTemplates('flyers')).rejects.toThrow('Product "flyers" not found');
  });
});
