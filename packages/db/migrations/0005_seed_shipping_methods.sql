-- Sample shipping methods (carrier not chosen yet). Flat sample prices, not carrier rates.
-- Source: docs/specs/business-card-mvp.md §7
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING),
-- so rows an admin has edited are never overwritten. Do not edit after it has been applied
-- to a shared environment; add a new migration instead.

INSERT INTO shipping_methods (code, label, transit_days_min, transit_days_max, price_cents, free_over_cents, sort_order, is_default, created_by)
SELECT s.code, s.label, s.transit_days_min, s.transit_days_max, s.price_cents, s.free_over_cents, s.sort_order, s.is_default, 'system:migration'
FROM (VALUES
    ('standard', 'Standard Shipping', 3, 5, 699, 10000, 1, true),
    ('expedited', 'Expedited Shipping', 2, 2, 1499, NULL::integer, 2, false),
    ('overnight', 'Overnight Shipping', 1, 1, 2999, NULL::integer, 3, false)
) AS s(code, label, transit_days_min, transit_days_max, price_cents, free_over_cents, sort_order, is_default)
ON CONFLICT (code) DO NOTHING;
