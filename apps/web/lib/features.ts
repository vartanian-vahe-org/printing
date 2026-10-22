/**
 * Storefront features that can be hidden while they are shown to reviewers one at a time.
 * NEXT_PUBLIC_HIDDEN_FEATURES="account,cart" hides them; unset shows everything (development, tests,
 * a full launch). The value is baked in at build time, so changing it needs a redeploy.
 * `design-service` hides "Let us design it for you" on the product page (no pages of its own).
 */
export type Feature = 'account' | 'cart' | 'design-service';

/** Pages that belong to each feature; the proxy sends visitors of hidden ones to the home page. */
export const FEATURE_PATHS: Record<Feature, string[]> = {
  account: ['/account'],
  cart: ['/cart', '/checkout', '/orders'],
  'design-service': [],
};

const hidden = new Set(
  (process.env.NEXT_PUBLIC_HIDDEN_FEATURES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

export function isEnabled(feature: Feature): boolean {
  return !hidden.has(feature);
}

/** True when `pathname` is a page of a hidden feature. */
export function isHiddenPath(pathname: string): boolean {
  return (Object.keys(FEATURE_PATHS) as Feature[]).some(
    (feature) => !isEnabled(feature) && FEATURE_PATHS[feature].some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}
