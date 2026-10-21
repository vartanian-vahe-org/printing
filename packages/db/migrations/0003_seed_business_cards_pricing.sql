-- Business card pricing (Vistaprint-style): base price per quantity tier + per-option upcharge per tier.
-- Source: docs/specs/business-card-mvp.md §4.1, §4.2
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING),
-- so rows an admin has edited are never overwritten. Do not edit after it has been applied
-- to a shared environment; add a new migration instead.

-- PLACEHOLDER PRICES. The whole price table will be redesigned later (decision B4).
-- Base prices = Vistaprint Matte standard cards. Upcharge = round(base x percent) per tier:
--   paper.16pt: +25%  (UPrinting 16pt Gloss $46.74 vs 14pt Gloss $37.29)
--   paper.17pt_uncoated: +166%  (UPrinting 17pt Uncoated $99.03 vs $37.29)
--   coating.gloss_both: +7%  (Vistaprint Glossy +$1 on $14.99)
--   coating.uncoated_both: +7%  (Vistaprint Uncoated +$1 on $14.99)
--   coating.uv_both: +7%  (placeholder, same as gloss)
--   coating.uv_front_uncoated_back: +43%  (UPrinting $53.32 vs $37.29)
--   coating.uv_front_gloss_back: +43%  (placeholder, same as UV front/uncoated back)
--   coating.soft_touch_both: +24%  (UPrinting 16pt Soft Touch $55.65 vs 16pt Gloss $46.74)
--   coating.silk_both: +24%  (UPrinting Silk priced as Soft Touch)
--   printed_side.front_back: +58%  (UPrinting 2 sides $37.29 vs 1 side $23.63)
--   printed_side.same_both: +58%  (same as front_back)
--   corners.rounded_quarter: +47%  (Vistaprint Rounded +$7 on $14.99)
--   turnaround.5d: -10%  (placeholder, no source data)
--   turnaround.2d: +30%  (UPrinting 2 days vs 3 days)
--   turnaround.1d: +80%  (UPrinting 1 day vs 3 days)
-- Size uses price_multiplier in option_values.attributes instead of upcharges (§4.3).

INSERT INTO product_quantity_tiers (product_id, quantity, base_price_cents, sort_order, is_default, created_by)
SELECT p.id, t.quantity, t.base_price_cents, t.sort_order, t.is_default, 'system:migration'
FROM products p
CROSS JOIN (VALUES
    (50, 1000, 1, false),
    (100, 1499, 2, false),
    (250, 1999, 3, false),
    (500, 2499, 4, true),
    (1000, 3799, 5, false),
    (2500, 8099, 6, false),
    (5000, 12799, 7, false),
    (10000, 22299, 8, false)
) AS t(quantity, base_price_cents, sort_order, is_default)
WHERE p.code = 'business-cards'
ON CONFLICT (product_id, quantity) DO NOTHING;
--> statement-breakpoint
INSERT INTO option_value_prices (option_value_id, quantity_tier_id, upcharge_cents, created_by)
SELECT ov.id, qt.id, u.upcharge_cents, 'system:migration'
FROM (VALUES
    ('paper', '16pt', 50, 250),
    ('paper', '16pt', 100, 375),
    ('paper', '16pt', 250, 500),
    ('paper', '16pt', 500, 625),
    ('paper', '16pt', 1000, 950),
    ('paper', '16pt', 2500, 2025),
    ('paper', '16pt', 5000, 3200),
    ('paper', '16pt', 10000, 5575),
    ('paper', '17pt_uncoated', 50, 1660),
    ('paper', '17pt_uncoated', 100, 2488),
    ('paper', '17pt_uncoated', 250, 3318),
    ('paper', '17pt_uncoated', 500, 4148),
    ('paper', '17pt_uncoated', 1000, 6306),
    ('paper', '17pt_uncoated', 2500, 13444),
    ('paper', '17pt_uncoated', 5000, 21246),
    ('paper', '17pt_uncoated', 10000, 37016),
    ('coating', 'gloss_both', 50, 70),
    ('coating', 'gloss_both', 100, 105),
    ('coating', 'gloss_both', 250, 140),
    ('coating', 'gloss_both', 500, 175),
    ('coating', 'gloss_both', 1000, 266),
    ('coating', 'gloss_both', 2500, 567),
    ('coating', 'gloss_both', 5000, 896),
    ('coating', 'gloss_both', 10000, 1561),
    ('coating', 'uncoated_both', 50, 70),
    ('coating', 'uncoated_both', 100, 105),
    ('coating', 'uncoated_both', 250, 140),
    ('coating', 'uncoated_both', 500, 175),
    ('coating', 'uncoated_both', 1000, 266),
    ('coating', 'uncoated_both', 2500, 567),
    ('coating', 'uncoated_both', 5000, 896),
    ('coating', 'uncoated_both', 10000, 1561),
    ('coating', 'uv_both', 50, 70),
    ('coating', 'uv_both', 100, 105),
    ('coating', 'uv_both', 250, 140),
    ('coating', 'uv_both', 500, 175),
    ('coating', 'uv_both', 1000, 266),
    ('coating', 'uv_both', 2500, 567),
    ('coating', 'uv_both', 5000, 896),
    ('coating', 'uv_both', 10000, 1561),
    ('coating', 'uv_front_uncoated_back', 50, 430),
    ('coating', 'uv_front_uncoated_back', 100, 645),
    ('coating', 'uv_front_uncoated_back', 250, 860),
    ('coating', 'uv_front_uncoated_back', 500, 1075),
    ('coating', 'uv_front_uncoated_back', 1000, 1634),
    ('coating', 'uv_front_uncoated_back', 2500, 3483),
    ('coating', 'uv_front_uncoated_back', 5000, 5504),
    ('coating', 'uv_front_uncoated_back', 10000, 9589),
    ('coating', 'uv_front_gloss_back', 50, 430),
    ('coating', 'uv_front_gloss_back', 100, 645),
    ('coating', 'uv_front_gloss_back', 250, 860),
    ('coating', 'uv_front_gloss_back', 500, 1075),
    ('coating', 'uv_front_gloss_back', 1000, 1634),
    ('coating', 'uv_front_gloss_back', 2500, 3483),
    ('coating', 'uv_front_gloss_back', 5000, 5504),
    ('coating', 'uv_front_gloss_back', 10000, 9589),
    ('coating', 'soft_touch_both', 50, 240),
    ('coating', 'soft_touch_both', 100, 360),
    ('coating', 'soft_touch_both', 250, 480),
    ('coating', 'soft_touch_both', 500, 600),
    ('coating', 'soft_touch_both', 1000, 912),
    ('coating', 'soft_touch_both', 2500, 1944),
    ('coating', 'soft_touch_both', 5000, 3072),
    ('coating', 'soft_touch_both', 10000, 5352),
    ('coating', 'silk_both', 50, 240),
    ('coating', 'silk_both', 100, 360),
    ('coating', 'silk_both', 250, 480),
    ('coating', 'silk_both', 500, 600),
    ('coating', 'silk_both', 1000, 912),
    ('coating', 'silk_both', 2500, 1944),
    ('coating', 'silk_both', 5000, 3072),
    ('coating', 'silk_both', 10000, 5352),
    ('printed_side', 'front_back', 50, 580),
    ('printed_side', 'front_back', 100, 869),
    ('printed_side', 'front_back', 250, 1159),
    ('printed_side', 'front_back', 500, 1449),
    ('printed_side', 'front_back', 1000, 2203),
    ('printed_side', 'front_back', 2500, 4697),
    ('printed_side', 'front_back', 5000, 7423),
    ('printed_side', 'front_back', 10000, 12933),
    ('printed_side', 'same_both', 50, 580),
    ('printed_side', 'same_both', 100, 869),
    ('printed_side', 'same_both', 250, 1159),
    ('printed_side', 'same_both', 500, 1449),
    ('printed_side', 'same_both', 1000, 2203),
    ('printed_side', 'same_both', 2500, 4697),
    ('printed_side', 'same_both', 5000, 7423),
    ('printed_side', 'same_both', 10000, 12933),
    ('corners', 'rounded_quarter', 50, 470),
    ('corners', 'rounded_quarter', 100, 705),
    ('corners', 'rounded_quarter', 250, 940),
    ('corners', 'rounded_quarter', 500, 1175),
    ('corners', 'rounded_quarter', 1000, 1786),
    ('corners', 'rounded_quarter', 2500, 3807),
    ('corners', 'rounded_quarter', 5000, 6016),
    ('corners', 'rounded_quarter', 10000, 10481),
    ('turnaround', '5d', 50, -100),
    ('turnaround', '5d', 100, -150),
    ('turnaround', '5d', 250, -200),
    ('turnaround', '5d', 500, -250),
    ('turnaround', '5d', 1000, -380),
    ('turnaround', '5d', 2500, -810),
    ('turnaround', '5d', 5000, -1280),
    ('turnaround', '5d', 10000, -2230),
    ('turnaround', '2d', 50, 300),
    ('turnaround', '2d', 100, 450),
    ('turnaround', '2d', 250, 600),
    ('turnaround', '2d', 500, 750),
    ('turnaround', '2d', 1000, 1140),
    ('turnaround', '2d', 2500, 2430),
    ('turnaround', '2d', 5000, 3840),
    ('turnaround', '2d', 10000, 6690),
    ('turnaround', '1d', 50, 800),
    ('turnaround', '1d', 100, 1199),
    ('turnaround', '1d', 250, 1599),
    ('turnaround', '1d', 500, 1999),
    ('turnaround', '1d', 1000, 3039),
    ('turnaround', '1d', 2500, 6479),
    ('turnaround', '1d', 5000, 10239),
    ('turnaround', '1d', 10000, 17839)
) AS u(group_code, value_code, quantity, upcharge_cents)
JOIN products p ON p.code = 'business-cards'
JOIN option_groups og ON og.product_id = p.id AND og.code = u.group_code
JOIN option_values ov ON ov.group_id = og.id AND ov.code = u.value_code
JOIN product_quantity_tiers qt ON qt.product_id = p.id AND qt.quantity = u.quantity
ON CONFLICT DO NOTHING;
