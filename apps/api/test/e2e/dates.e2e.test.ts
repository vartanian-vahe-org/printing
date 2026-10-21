/**
 * Ship and delivery estimates through the API: same results as the shared schedule functions
 * with the calendar the API publishes.
 */
import { deliveryWindow, productionSchedule, type ProductionCalendar } from '@printing/pricing';
import { describe, expect, it } from 'vitest';
import { address, base, selection, testHeaders, uniqueEmail } from './helpers.js';

async function calendar(): Promise<ProductionCalendar> {
  const res = await fetch(`${base}/products/business-cards/configurator`);
  return ((await res.json()) as { calendar: ProductionCalendar }).calendar;
}

function guest() {
  let cookie = '';
  return async (path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...testHeaders, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return (await res.json()) as Record<string, any>;
  };
}

const item = (turnaround: string) => ({
  productCode: 'business-cards',
  configuration: { selection: { ...selection, turnaround }, quantity: 500 },
  design: { mode: 'template', templateCode: 'classic', values: { name: 'Jamie' } },
});

describe('estimated dates', () => {
  it('publishes the shop calendar with the configurator', async () => {
    const cal = await calendar();
    expect(cal).toMatchObject({ timezone: 'America/Los_Angeles', cutoffTime: '14:00', workingDays: [1, 2, 3, 4, 5] });
    expect(cal.holidays.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it('ships the cart when its slowest item is printed, and dates each shipping option', async () => {
    const cal = await calendar();
    const call = guest();
    await call('/cart/items', item('2d'));
    const cart = await call('/cart/items', item('5d'));

    const now = new Date();
    const fast = productionSchedule(now, 2, cal).shipDate;
    const slow = productionSchedule(now, 5, cal).shipDate;
    expect(cart.items.map((i: any) => i.shipDate)).toEqual([fast, slow]);
    expect(cart.shipDate).toBe(slow);
    expect(cart.timezone).toBe('America/Los_Angeles');

    const quote = await call('/checkout/quote', { address: { state: 'CA', zip: '90012' } });
    for (const option of quote.shippingOptions) {
      const window = deliveryWindow(slow, option.transitDaysMin, option.transitDaysMax, cal);
      expect([option.deliveryFrom, option.deliveryTo]).toEqual([window.from, window.to]);
    }

    const order = await call('/checkout/orders', {
      email: uniqueEmail(),
      shippingAddress: address,
      shippingMethodCode: 'standard',
      expectedTotalCents: quote.totals.totalCents,
    });
    const view = await fetch(`${base}/orders/${order.number}`, { headers: { 'x-order-token': order.accessToken } }).then((r) => r.json());
    const standard = quote.shippingOptions[0];
    expect(view).toMatchObject({ shipBy: slow, deliverFrom: standard.deliveryFrom, deliverTo: standard.deliveryTo });
  });
});
