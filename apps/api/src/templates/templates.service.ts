import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Database, products, templates } from '@printing/db';
import { parseLayout, type Template } from '@printing/templates';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../database/database.tokens.js';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Active templates of a product, layouts validated against the layout schema.
   * A template with an invalid layout (e.g. a bad admin edit) is skipped and logged,
   * so one broken template cannot take the storefront down.
   */
  async listTemplates(productCode: string): Promise<Template[]> {
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.code, productCode), eq(products.isActive, true)))
      .limit(1);
    if (!product) throw new NotFoundException(`Product "${productCode}" not found`);

    const rows = await this.db
      .select()
      .from(templates)
      .where(and(eq(templates.productId, product.id), eq(templates.isActive, true)))
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
        });
      } catch (err) {
        this.logger.warn(`Skipping template "${row.code}": invalid layout (${err instanceof Error ? err.message : err})`);
      }
    }
    return result;
  }
}
