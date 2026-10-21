/**
 * Default payment / shipping / tax providers (docs/decisions.md T14) against the seeded database.
 * Requires DATABASE_URL pointing at a migrated database.
 */
import { createDb } from '@printing/db';
import { afterAll, describe, expect, it } from 'vitest';
import { FlatRateShippingProvider } from '../../src/commerce/providers/flat-rate-shipping.provider.js';
import { ManualPaymentProvider } from '../../src/commerce/providers/manual-payment.provider.js';
import { StateTableTaxProvider } from '../../src/commerce/providers/state-table-tax.provider.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for integration tests');
const { db, pool } = createDb(url, { max: 2 });

afterAll(async () => {
  await pool.end();
});

describe('FlatRateShippingProvider (seeded shipping_methods)', () => {
  const shipping = new FlatRateShippingProvider(db);

  it('returns the three sample methods with their flat prices below $100', async () => {
    const rates = await shipping.rates({ address: { state: 'NY', zip: '10001' }, subtotalCents: 3948 });
    expect(rates.map((r) => [r.code, r.priceCents, r.isFree])).toEqual([
      ['standard', 699, false],
      ['expedited', 1499, false],
      ['overnight', 2999, false],
    ]);
  });

  it('makes standard shipping free from $100', async () => {
    const rates = await shipping.rates({ address: { state: 'NY', zip: '10001' }, subtotalCents: 10000 });
    expect(rates.find((r) => r.code === 'standard')).toMatchObject({ priceCents: 0, isFree: true });
    expect(rates.find((r) => r.code === 'overnight')).toMatchObject({ priceCents: 2999, isFree: false });
  });
});

describe('StateTableTaxProvider (seeded tax_rates)', () => {
  const tax = new StateTableTaxProvider(db);

  it('applies the California placeholder rate to the subtotal only', async () => {
    const result = await tax.calculate({ address: { state: 'CA', zip: '94103', city: 'San Francisco' }, subtotalCents: 3948, shippingCents: 699 });
    expect(result).toMatchObject({ provider: 'state_table', rateBps: 725, taxCents: 286 });
  });

  it('collects nothing for states without a rate', async () => {
    const result = await tax.calculate({ address: { state: 'OR', zip: '97201', city: 'Portland' }, subtotalCents: 3948, shippingCents: 699 });
    expect(result).toMatchObject({ taxCents: 0, rateBps: 0 });
  });
});

describe('ManualPaymentProvider', () => {
  it('leaves the order pending with instructions for the customer', async () => {
    const result = await new ManualPaymentProvider().start({ orderId: 'x', orderNumber: 100001, amountCents: 4933, email: 'a@b.com' });
    expect(result.status).toBe('pending');
    expect(result.next).toMatchObject({ type: 'manual' });
    expect(result.next.type === 'manual' && result.next.message).toContain('#100001');
  });
});
