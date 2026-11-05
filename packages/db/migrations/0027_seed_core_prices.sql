-- Core options (size, paper, printed sides) get a set price per quantity (core_prices), and the other
-- options a percent of it (option_values.addon_percent), instead of base + $ upcharges × size multiplier.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
-- Prices are placeholders until the shop fills in its own (docs/open-issues.md P8): each combination
-- starts at what the old formula charged for it, and the percents are the old upcharges as a share of
-- the default card's price, to the whole percent.

-- 1. One price per size × paper × printed sides × quantity. The custom size has no set price.
INSERT INTO core_prices (size_value_id, paper_value_id, printed_side_value_id, quantity_tier_id, price_cents, created_by)
SELECT sz.id, pa.id, ps.id, qt.id,
       round((qt.base_price_cents + coalesce(pa_up.upcharge_cents, 0) + coalesce(ps_up.upcharge_cents, 0))
             * (sz.attributes->>'price_multiplier')::numeric)::integer,
       'system:migration'
FROM products p
JOIN option_groups sz_g ON sz_g.product_id = p.id AND sz_g.code = 'size'
JOIN option_values sz ON sz.group_id = sz_g.id AND sz.code <> 'custom'
JOIN option_groups pa_g ON pa_g.product_id = p.id AND pa_g.code = 'paper'
JOIN option_values pa ON pa.group_id = pa_g.id
JOIN option_groups ps_g ON ps_g.product_id = p.id AND ps_g.code = 'printed_side'
JOIN option_values ps ON ps.group_id = ps_g.id
JOIN product_quantity_tiers qt ON qt.product_id = p.id
LEFT JOIN option_value_prices pa_up ON pa_up.option_value_id = pa.id AND pa_up.quantity_tier_id = qt.id
LEFT JOIN option_value_prices ps_up ON ps_up.option_value_id = ps.id AND ps_up.quantity_tier_id = qt.id
WHERE p.code = 'business-cards'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. Add-ons: the old upcharge as a percent of the default card, averaged over the quantities.
UPDATE option_values ov
SET addon_percent = share.percent, updated_by = 'system:migration', updated_at = now()
FROM (
    SELECT up.option_value_id, round(avg(up.upcharge_cents * 100.0 / cp.price_cents)) AS percent
    FROM option_value_prices up
    JOIN option_values addon ON addon.id = up.option_value_id
    JOIN option_groups addon_g ON addon_g.id = addon.group_id AND addon_g.code NOT IN ('size', 'paper', 'printed_side', 'turnaround')
    JOIN option_values sz ON sz.is_default AND sz.group_id = (SELECT id FROM option_groups WHERE product_id = addon_g.product_id AND code = 'size')
    JOIN option_values pa ON pa.is_default AND pa.group_id = (SELECT id FROM option_groups WHERE product_id = addon_g.product_id AND code = 'paper')
    JOIN option_values ps ON ps.is_default AND ps.group_id = (SELECT id FROM option_groups WHERE product_id = addon_g.product_id AND code = 'printed_side')
    JOIN core_prices cp ON cp.size_value_id = sz.id AND cp.paper_value_id = pa.id AND cp.printed_side_value_id = ps.id
        AND cp.quantity_tier_id = up.quantity_tier_id
    GROUP BY up.option_value_id
) AS share
WHERE ov.id = share.option_value_id;
--> statement-breakpoint

-- 3. No custom size: a size typed in by the customer has no set price. Carts holding it ask to choose again.
UPDATE templates SET supported_size_codes = array_remove(supported_size_codes, 'custom'), updated_by = 'system:migration', updated_at = now()
WHERE 'custom' = ANY (supported_size_codes);
--> statement-breakpoint
DELETE FROM option_values ov
USING option_groups og
WHERE og.id = ov.group_id AND og.code = 'size' AND ov.code = 'custom';
--> statement-breakpoint

-- 4. Sizes no longer carry a multiplier.
UPDATE option_values ov
SET attributes = ov.attributes - 'price_multiplier', updated_by = 'system:migration', updated_at = now()
FROM option_groups og
WHERE og.id = ov.group_id AND og.code = 'size';
--> statement-breakpoint

-- 5. Core options come first: size, paper, printed sides, then the add-ons.
UPDATE option_groups SET sort_order = 3, updated_by = 'system:migration', updated_at = now() WHERE code = 'printed_side';
--> statement-breakpoint
UPDATE option_groups SET sort_order = 4, updated_by = 'system:migration', updated_at = now() WHERE code = 'coating';
