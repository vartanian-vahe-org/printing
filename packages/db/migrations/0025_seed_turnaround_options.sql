-- Turnaround becomes production speeds with a quantity × speed table (turnaround_options): days and a
-- percent of the printing price per quantity, instead of fixed-day options with $ upcharges.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
-- Days and percents are placeholders until the shop confirms them (docs/open-issues.md P7). The
-- percents are the old upcharge ratios (−10% / 0 / +30% / +80% of the base price, P2).

-- 1. 5d / 3d / 2d / 1d become speeds; their days move out of attributes into the table.
UPDATE option_values ov
SET code = m.new_code, label = m.label, attributes = '{}'::jsonb, updated_by = 'system:migration', updated_at = now()
FROM option_groups og, (VALUES
    ('5d', 'economy', 'Economy'),
    ('3d', 'standard', 'Standard'),
    ('2d', 'express', 'Express'),
    ('1d', 'rush', 'Rush')
) AS m(old_code, new_code, label)
WHERE og.id = ov.group_id AND og.code = 'turnaround' AND ov.code = m.old_code;
--> statement-breakpoint

-- 2. Days by quantity band: up to 1,000 as before, +1 day for 2,500–5,000, +2 days above. No rush above 5,000.
INSERT INTO turnaround_options (option_value_id, quantity_tier_id, business_days, price_percent, created_by)
SELECT ov.id, qt.id,
       s.days + CASE WHEN qt.quantity <= 1000 THEN 0 WHEN qt.quantity <= 5000 THEN 1 ELSE 2 END,
       s.percent, 'system:migration'
FROM (VALUES
    ('economy', 5, -10),
    ('standard', 3, 0),
    ('express', 2, 30),
    ('rush', 1, 80)
) AS s(code, days, percent)
JOIN products p ON p.code = 'business-cards'
JOIN option_groups og ON og.product_id = p.id AND og.code = 'turnaround'
JOIN option_values ov ON ov.group_id = og.id AND ov.code = s.code
JOIN product_quantity_tiers qt ON qt.product_id = p.id
WHERE NOT (s.code = 'rush' AND qt.quantity > 5000)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. Turnaround is priced by percent now; its old $ upcharges go.
DELETE FROM option_value_prices ovp
USING option_values ov, option_groups og
WHERE ov.id = ovp.option_value_id AND og.id = ov.group_id AND og.code = 'turnaround';
