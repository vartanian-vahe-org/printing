-- Business card option rules R1-R7: when a value is selected, the target group may only use the listed values.
-- Source: docs/specs/business-card-mvp.md §3
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING),
-- so rows an admin has edited are never overwritten. Do not edit after it has been applied
-- to a shared environment; add a new migration instead.

-- R1: paper=14pt -> coating in (matte_both, gloss_both, uncoated_both, uv_both, uv_front_uncoated_back, uv_front_gloss_back)
-- R2: paper=16pt -> coating in (matte_both, gloss_both, soft_touch_both, silk_both)
-- R3: paper=17pt_uncoated -> coating in (uncoated_both)
-- R4: paper=17pt_uncoated -> turnaround in (5d, 3d, 2d)
-- R5: coating=uv_front_uncoated_back -> turnaround in (5d, 3d, 2d)
-- R6: coating=uncoated_both -> turnaround in (5d, 3d, 2d)
-- R7: printed_side=front_only -> coating in (matte_both, gloss_both, uncoated_both, uv_both, soft_touch_both, silk_both)

INSERT INTO option_value_rules (product_id, when_value_id, target_group_id, created_by)
SELECT p.id, wv.id, tg.id, 'system:migration'
FROM (VALUES
    ('paper', '14pt', 'coating'),
    ('paper', '16pt', 'coating'),
    ('paper', '17pt_uncoated', 'coating'),
    ('paper', '17pt_uncoated', 'turnaround'),
    ('coating', 'uv_front_uncoated_back', 'turnaround'),
    ('coating', 'uncoated_both', 'turnaround'),
    ('printed_side', 'front_only', 'coating')
) AS r(when_group, when_value, target_group)
JOIN products p ON p.code = 'business-cards'
JOIN option_groups wg ON wg.product_id = p.id AND wg.code = r.when_group
JOIN option_values wv ON wv.group_id = wg.id AND wv.code = r.when_value
JOIN option_groups tg ON tg.product_id = p.id AND tg.code = r.target_group
ON CONFLICT (when_value_id, target_group_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO option_value_rule_allowed (rule_id, value_id)
SELECT ru.id, av.id
FROM (VALUES
    ('paper', '14pt', 'coating', 'matte_both'),
    ('paper', '14pt', 'coating', 'gloss_both'),
    ('paper', '14pt', 'coating', 'uncoated_both'),
    ('paper', '14pt', 'coating', 'uv_both'),
    ('paper', '14pt', 'coating', 'uv_front_uncoated_back'),
    ('paper', '14pt', 'coating', 'uv_front_gloss_back'),
    ('paper', '16pt', 'coating', 'matte_both'),
    ('paper', '16pt', 'coating', 'gloss_both'),
    ('paper', '16pt', 'coating', 'soft_touch_both'),
    ('paper', '16pt', 'coating', 'silk_both'),
    ('paper', '17pt_uncoated', 'coating', 'uncoated_both'),
    ('paper', '17pt_uncoated', 'turnaround', '5d'),
    ('paper', '17pt_uncoated', 'turnaround', '3d'),
    ('paper', '17pt_uncoated', 'turnaround', '2d'),
    ('coating', 'uv_front_uncoated_back', 'turnaround', '5d'),
    ('coating', 'uv_front_uncoated_back', 'turnaround', '3d'),
    ('coating', 'uv_front_uncoated_back', 'turnaround', '2d'),
    ('coating', 'uncoated_both', 'turnaround', '5d'),
    ('coating', 'uncoated_both', 'turnaround', '3d'),
    ('coating', 'uncoated_both', 'turnaround', '2d'),
    ('printed_side', 'front_only', 'coating', 'matte_both'),
    ('printed_side', 'front_only', 'coating', 'gloss_both'),
    ('printed_side', 'front_only', 'coating', 'uncoated_both'),
    ('printed_side', 'front_only', 'coating', 'uv_both'),
    ('printed_side', 'front_only', 'coating', 'soft_touch_both'),
    ('printed_side', 'front_only', 'coating', 'silk_both')
) AS r(when_group, when_value, target_group, allowed_value)
JOIN products p ON p.code = 'business-cards'
JOIN option_groups wg ON wg.product_id = p.id AND wg.code = r.when_group
JOIN option_values wv ON wv.group_id = wg.id AND wv.code = r.when_value
JOIN option_groups tg ON tg.product_id = p.id AND tg.code = r.target_group
JOIN option_value_rules ru ON ru.when_value_id = wv.id AND ru.target_group_id = tg.id
JOIN option_values av ON av.group_id = tg.id AND av.code = r.allowed_value
ON CONFLICT DO NOTHING;
