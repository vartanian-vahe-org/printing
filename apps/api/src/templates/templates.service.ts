import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Database, designServiceTiers, products, templateFacets, templates } from '@printing/db';
import { parseLayout, type DesignServiceTier, type Template, type TemplateFacet } from '@printing/templates';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';

type Executor = Pick<Database, 'select'>;

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async productId(productCode: string, db: Executor = this.db): Promise<string> {
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.code, productCode), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundException(`Product "${productCode}" not found`);
    return product.id;
  }

  /**
   * Active templates of a product, layouts validated against the layout schema.
   * A template with an invalid layout (e.g. a bad admin edit) is skipped and logged,
   * so one broken template cannot take the storefront down.
   */
  async listTemplates(productCode: string): Promise<Template[]> {
    const productId = await this.productId(productCode);
    const rows = await this.db
      .select()
      .from(templates)
      .where(and(eq(templates.productId, productId), eq(templates.isActive, true)))
      .orderBy(asc(templates.sortOrder));

    const result: Template[] = [];
    for (const row of rows) {
      try {
        result.push({
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sortOrder,
          supportedSizeCodes: row.supportedSizeCodes,
          layout: parseLayout(row.layout),
          tags: row.tags,
        });
      } catch (err) {
        this.logger.warn(`Skipping template "${row.code}": invalid layout (${err instanceof Error ? err.message : err})`);
      }
    }
    return result;
  }

  /** Template filters of a product (Industry, Style…), with values that no template uses left out. */
  async listFacets(productCode: string, used: Template[]): Promise<TemplateFacet[]> {
    const productId = await this.productId(productCode);
    const rows = await this.db.select().from(templateFacets).where(eq(templateFacets.productId, productId)).orderBy(asc(templateFacets.sortOrder));
    return rows
      .map((row) => ({
        code: row.code,
        name: row.name,
        values: row.values.filter((value) => used.some((t) => t.tags?.[row.code]?.includes(value.code))),
      }))
      .filter((facet) => facet.values.length > 0);
  }

  /** Design service packages on offer for a product, cheapest first by the admin's order. */
  async listDesignServices(productCode: string, db: Executor = this.db): Promise<DesignServiceTier[]> {
    const productId = await this.productId(productCode, db);
    const rows = await db
      .select()
      .from(designServiceTiers)
      .where(and(eq(designServiceTiers.productId, productId), eq(designServiceTiers.isActive, true)))
      .orderBy(asc(designServiceTiers.sortOrder));
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      features: row.features,
      designDays: row.designDays,
      revisions: row.revisions,
    }));
  }
}
