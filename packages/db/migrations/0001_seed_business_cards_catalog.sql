-- Business card catalog: product, option groups, option values.
-- Source: docs/specs/business-card-mvp.md §2
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING),
-- so rows an admin has edited are never overwritten. Do not edit after it has been applied
-- to a shared environment; add a new migration instead.

INSERT INTO products (code, name, created_by)
VALUES ('business-cards', 'Business Cards', 'system:migration')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO option_groups (product_id, code, label, sort_order, display_style, created_by)
SELECT p.id, g.code, g.label, g.sort_order, 'dropdown', 'system:migration'
FROM products p
CROSS JOIN (VALUES
    ('size', 'Size', 1),
    ('paper', 'Paper', 2),
    ('coating', 'Coating', 3),
    ('printed_side', 'Printed Side', 4),
    ('corners', 'Corners', 5),
    ('turnaround', 'Turnaround', 6)
) AS g(code, label, sort_order)
WHERE p.code = 'business-cards'
ON CONFLICT (product_id, code) DO NOTHING;
--> statement-breakpoint
INSERT INTO option_values (group_id, code, label, description, sort_order, is_default, attributes, created_by)
SELECT g.id, v.code, v.label, v.description, v.sort_order, v.is_default, v.attributes::jsonb, 'system:migration'
FROM (VALUES
    ('size', 'std_3_5x2', 'Standard 3.5" x 2"', 'The classic US business card size.', 1, true, '{"trim_w_in":3.5,"trim_h_in":2,"bleed_in":0.125,"safe_in":0.125,"price_multiplier":1}'),
    ('size', 'square_2_5', 'Square 2.5" x 2.5"', 'A bold square format.', 2, false, '{"trim_w_in":2.5,"trim_h_in":2.5,"bleed_in":0.125,"safe_in":0.125,"price_multiplier":1.96}'),
    ('size', 'slim_3_5x1_75', 'Slim 3.5" x 1.75"', 'A narrower, modern profile.', 3, false, '{"trim_w_in":3.5,"trim_h_in":1.75,"bleed_in":0.125,"safe_in":0.125,"price_multiplier":1.31}'),
    ('size', 'custom', 'Custom Size', 'Choose width and height from 2" to 4" in 0.25" steps.', 4, false, '{"min_in":2,"max_in":4,"step_in":0.25,"bleed_in":0.125,"safe_in":0.125,"fit_box":{"w_in":3.5,"h_in":2},"fit_multiplier":1.25,"area_multiplier":0.283}'),
    ('paper', '14pt', 'Standard – 14pt Cardstock', 'Our everyday cardstock with a solid, professional feel.', 1, true, '{"thickness_pt":14,"tier":"standard"}'),
    ('paper', '16pt', 'Premium – 16pt Cardstock', 'Thicker and sturdier, the most popular choice for business cards.', 2, false, '{"thickness_pt":16,"tier":"premium"}'),
    ('paper', '17pt_uncoated', 'Premium Uncoated – 17pt Cardstock', 'Natural uncoated finish that is easy to write on.', 3, false, '{"thickness_pt":17,"tier":"premium"}'),
    ('coating', 'matte_both', 'Matte Both Sides', 'Smooth, shine-free finish.', 1, true, '{"front":"matte","back":"matte","laminated":false}'),
    ('coating', 'gloss_both', 'Gloss Both Sides', 'Light sheen that makes colors pop.', 2, false, '{"front":"gloss","back":"gloss","laminated":false}'),
    ('coating', 'uncoated_both', 'Uncoated Both Sides', 'Natural paper feel, writable on both sides.', 3, false, '{"front":"none","back":"none","laminated":false}'),
    ('coating', 'uv_both', 'High Gloss UV Both Sides', 'Mirror-like high gloss on both sides.', 4, false, '{"front":"uv","back":"uv","laminated":false}'),
    ('coating', 'uv_front_uncoated_back', 'High Gloss UV Front, Uncoated Back', 'High gloss front with a writable back.', 5, false, '{"front":"uv","back":"none","laminated":false}'),
    ('coating', 'uv_front_gloss_back', 'High Gloss UV Front, Gloss Back', 'High gloss front with a lighter gloss back.', 6, false, '{"front":"uv","back":"gloss","laminated":false}'),
    ('coating', 'soft_touch_both', 'Soft Touch (Laminated)', 'Velvety laminated finish with a premium feel.', 7, false, '{"front":"soft_touch","back":"soft_touch","laminated":true}'),
    ('coating', 'silk_both', 'Silk (Laminated)', 'Satin-smooth laminated finish.', 8, false, '{"front":"silk","back":"silk","laminated":true}'),
    ('printed_side', 'front_back', 'Full Color, Front and Back', NULL, 1, true, '{"back":"separate"}'),
    ('printed_side', 'front_only', 'Full Color Front, Blank Back', NULL, 2, false, '{"back":"blank"}'),
    ('printed_side', 'same_both', 'Full Color, Same Artwork Both Sides', NULL, 3, false, '{"back":"same_as_front"}'),
    ('corners', 'square', 'Standard (Square)', NULL, 1, true, '{"radius_in":0}'),
    ('corners', 'rounded_quarter', 'Rounded 1/4"', NULL, 2, false, '{"radius_in":0.25}'),
    ('turnaround', '5d', '5 Business Days', NULL, 1, false, '{"business_days":5}'),
    ('turnaround', '3d', '3 Business Days', NULL, 2, true, '{"business_days":3}'),
    ('turnaround', '2d', '2 Business Days', NULL, 3, false, '{"business_days":2}'),
    ('turnaround', '1d', '1 Business Day', NULL, 4, false, '{"business_days":1}')
) AS v(group_code, code, label, description, sort_order, is_default, attributes)
JOIN products p ON p.code = 'business-cards'
JOIN option_groups g ON g.product_id = p.id AND g.code = v.group_code
ON CONFLICT (group_id, code) DO NOTHING;
