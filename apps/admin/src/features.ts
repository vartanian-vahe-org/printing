/**
 * Admin pages that can be hidden while the admin is shown to reviewers one part at a time, like the
 * storefront's NEXT_PUBLIC_HIDDEN_FEATURES. VITE_HIDDEN_FEATURES="orders,settings" hides them; unset shows
 * everything (development, a full launch). The value is baked in at build time, so changing it needs a
 * redeploy. Hiding is cosmetic: the API still guards every route by role.
 */
export type Feature = 'orders' | 'settings' | 'staff' | 'activity';

/** Pages that belong to each feature; visiting a hidden one sends the user to the first visible page. */
export const FEATURE_PATHS: Record<Feature, string> = {
  orders: '/orders',
  settings: '/settings',
  staff: '/staff',
  activity: '/activity',
};

const hidden = new Set(
  (import.meta.env.VITE_HIDDEN_FEATURES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

export function isEnabled(feature: Feature): boolean {
  return !hidden.has(feature);
}

/** True when `path` is a page of a hidden feature (or below it, like /orders/1001). */
export function isHiddenPath(path: string): boolean {
  return (Object.keys(FEATURE_PATHS) as Feature[]).some(
    (feature) => !isEnabled(feature) && (path === FEATURE_PATHS[feature] || path.startsWith(`${FEATURE_PATHS[feature]}/`)),
  );
}
