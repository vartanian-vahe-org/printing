import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(hidden: string | undefined) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_HIDDEN_FEATURES', hidden);
  return import('../lib/features');
}

afterEach(() => vi.unstubAllEnvs());

describe('feature flags', () => {
  it('shows everything when nothing is hidden', async () => {
    const { isEnabled, isHiddenPath } = await load(undefined);
    expect(isEnabled('cart')).toBe(true);
    expect(isEnabled('account')).toBe(true);
    expect(isHiddenPath('/cart')).toBe(false);
  });

  it('hides the pages of hidden features only', async () => {
    const { isEnabled, isHiddenPath } = await load(' account , cart ');
    expect(isEnabled('cart')).toBe(false);
    expect(isEnabled('account')).toBe(false);
    for (const path of ['/cart', '/checkout', '/orders/find', '/orders/1042', '/account', '/account/verify']) expect(isHiddenPath(path)).toBe(true);
    for (const path of ['/', '/business-cards', '/cartography', '/api/cart']) expect(isHiddenPath(path)).toBe(false);
  });

  it('hides the design service without hiding any page', async () => {
    const { isEnabled, isHiddenPath } = await load('design-service');
    expect(isEnabled('design-service')).toBe(false);
    expect(isHiddenPath('/business-cards')).toBe(false);
  });

  it('hides one feature without the other', async () => {
    const { isEnabled, isHiddenPath } = await load('account');
    expect(isEnabled('cart')).toBe(true);
    expect(isHiddenPath('/checkout')).toBe(false);
    expect(isHiddenPath('/account')).toBe(true);
  });
});
