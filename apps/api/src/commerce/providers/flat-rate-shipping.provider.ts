import { Inject, Injectable } from '@nestjs/common';
import { type Database, shippingMethods } from '@printing/db';
import { priceShippingOption, type PricedShippingOption } from '@printing/pricing';
import { asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';
import type { ShippingRateProvider, ShippingRateRequest } from '../ports.js';

/**
 * Default shipping rates until a carrier is chosen (docs/open-issues.md S1): the flat prices in
 * `shipping_methods` (editable in the admin), free above each method's threshold.
 * The same price applies to every US address.
 */
@Injectable()
export class FlatRateShippingProvider implements ShippingRateProvider {
  readonly code = 'flat_rate';

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async rates(request: ShippingRateRequest): Promise<PricedShippingOption[]> {
    const rows = await this.db
      .select()
      .from(shippingMethods)
      .where(eq(shippingMethods.isActive, true))
      .orderBy(asc(shippingMethods.sortOrder));
    return rows.map((row) =>
      priceShippingOption(
        {
          code: row.code,
          label: row.label,
          basePriceCents: row.priceCents,
          freeOverCents: row.freeOverCents,
          transitDaysMin: row.transitDaysMin,
          transitDaysMax: row.transitDaysMax,
        },
        request.subtotalCents,
      ),
    );
  }
}
