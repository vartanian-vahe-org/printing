-- Each turnaround speed gets its days and percent in the option library, taken from the smallest quantity
-- that offers it (1 day at 0% for a speed nothing offers yet). A product ticking a speed starts from them.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
UPDATE option_values v
SET attributes = jsonb_build_object('min_days', c.min_days, 'max_days', c.max_days, 'percent', c.percent)
FROM (
  SELECT DISTINCT ON (t.option_value_id) t.option_value_id, t.min_business_days AS min_days, t.business_days AS max_days, t.price_percent AS percent
  FROM turnaround_options t
  JOIN product_quantity_tiers q ON q.id = t.quantity_tier_id
  ORDER BY t.option_value_id, q.quantity
) c
WHERE v.id = c.option_value_id;
--> statement-breakpoint
UPDATE option_values v
SET attributes = '{"min_days": 1, "max_days": 1, "percent": 0}'
FROM option_groups g
WHERE g.id = v.group_id AND g.code = 'turnaround' AND NOT v.attributes ? 'max_days';
--> statement-breakpoint
-- Speeds a product ticked without filling its table now apply at all its quantities.
INSERT INTO turnaround_options (option_value_id, quantity_tier_id, min_business_days, business_days, price_percent)
SELECT v.id, q.id, (v.attributes->>'min_days')::int, (v.attributes->>'max_days')::int, (v.attributes->>'percent')::numeric
FROM product_option_values p
JOIN option_groups g ON g.id = p.group_id AND g.code = 'turnaround'
JOIN option_values v ON v.id = p.value_id
JOIN product_quantity_tiers q ON q.product_id = p.product_id
WHERE NOT EXISTS (
  SELECT 1 FROM turnaround_options t
  JOIN product_quantity_tiers q2 ON q2.id = t.quantity_tier_id
  WHERE t.option_value_id = v.id AND q2.product_id = p.product_id
);
