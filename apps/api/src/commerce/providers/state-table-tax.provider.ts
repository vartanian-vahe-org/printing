import { Inject, Injectable } from '@nestjs/common';
import { type Database, taxRates } from '@printing/db';
import { taxForAmount } from '@printing/pricing';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens.js';
import type { TaxProvider, TaxRequest, TaxResult } from '../ports.js';

/**
 * Default sales tax until a tax service is chosen (docs/open-issues.md S7): one rate per state from
 * `tax_rates`, applied to the merchandise subtotal only (shipping not taxed, open issue S8).
 * States without a row are not taxed. Seeded CA rate is the state base rate only (placeholder).
 */
@Injectable()
export class StateTableTaxProvider implements TaxProvider {
  readonly code = 'state_table';

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async calculate(request: TaxRequest): Promise<TaxResult> {
    const [rate] = await this.db
      .select({ rateBps: taxRates.rateBps, label: taxRates.label })
      .from(taxRates)
      .where(and(eq(taxRates.state, request.address.state), eq(taxRates.isActive, true)))
      .limit(1);
    if (!rate) return { provider: this.code, taxCents: 0, rateBps: 0, label: 'No sales tax collected for this state' };
    return {
      provider: this.code,
      taxCents: taxForAmount(request.subtotalCents, rate.rateBps),
      rateBps: rate.rateBps,
      label: rate.label,
    };
  }
}
