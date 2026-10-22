-- Default template filters, template tags and design service packages for business cards.
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING) and tags are only
-- set on templates that have none, so admin edits are never overwritten. Do not edit after it has
-- been applied to a shared environment; add a new migration instead.
-- Prices are placeholders until decided (docs/open-issues.md P6).

INSERT INTO template_facets (product_id, code, name, sort_order, "values", created_by)
SELECT p.id, f.code, f.name, f.sort_order, f.vals::jsonb, 'system:migration'
FROM (VALUES
    ('industry', 'Industry', 1, '[
      {"code":"real-estate","name":"Real Estate"},
      {"code":"consulting-finance","name":"Consulting & Finance"},
      {"code":"legal","name":"Legal"},
      {"code":"creative-design","name":"Creative & Design"},
      {"code":"health-wellness","name":"Health & Wellness"},
      {"code":"beauty-spa","name":"Beauty & Spa"},
      {"code":"food-drink","name":"Food & Drink"},
      {"code":"technology","name":"Technology"},
      {"code":"construction-trades","name":"Construction & Trades"}
    ]'),
    ('style', 'Style', 2, '[
      {"code":"classic","name":"Classic"},
      {"code":"modern","name":"Modern"},
      {"code":"minimal","name":"Minimal"},
      {"code":"elegant","name":"Elegant"},
      {"code":"bold","name":"Bold"}
    ]'),
    ('color', 'Color', 3, '[
      {"code":"white","name":"White"},
      {"code":"dark","name":"Black & Dark"},
      {"code":"blue","name":"Blue"},
      {"code":"green","name":"Green & Teal"},
      {"code":"gold","name":"Gold & Yellow"}
    ]')
) AS f(code, name, sort_order, vals)
JOIN products p ON p.code = 'business-cards'
ON CONFLICT (product_id, code) DO NOTHING;
--> statement-breakpoint
UPDATE templates t
SET tags = v.tags::jsonb, updated_by = 'system:migration'
FROM (VALUES
    ('classic', '{"industry":["consulting-finance","legal","real-estate","construction-trades"],"style":["classic"],"color":["white","blue"]}'),
    ('centered', '{"industry":["legal","beauty-spa","health-wellness","consulting-finance"],"style":["elegant","classic"],"color":["white","gold"]}'),
    ('color-band', '{"industry":["health-wellness","technology","food-drink","real-estate"],"style":["modern","bold"],"color":["white","green"]}'),
    ('minimal', '{"industry":["creative-design","technology","consulting-finance"],"style":["minimal","modern"],"color":["white"]}'),
    ('midnight', '{"industry":["creative-design","technology","beauty-spa","food-drink"],"style":["bold","modern"],"color":["dark","gold"]}')
) AS v(code, tags),
products p
WHERE p.code = 'business-cards' AND t.product_id = p.id AND t.code = v.code AND t.tags = '{}'::jsonb;
--> statement-breakpoint
INSERT INTO design_service_tiers (product_id, code, name, description, price_cents, features, design_days, revisions, sort_order, created_by)
SELECT p.id, s.code, s.name, s.description, s.price_cents, s.features::jsonb, s.design_days, s.revisions, s.sort_order, 'system:migration'
FROM (VALUES
    ('standard', 'Standard', 'A professional design from your details and logo.', 2900,
      '["1 design concept, front and back","2 rounds of changes","First draft in 2 business days"]', 2, 2, 1),
    ('premium', 'Premium', 'More ideas to choose from and extra polish.', 5900,
      '["2 design concepts to choose from","4 rounds of changes","Logo cleanup from a photo or low-resolution file","First draft in 2 business days"]', 2, 4, 2),
    ('elite', 'Elite', 'Our senior designer, unlimited changes and priority turnaround.', 9900,
      '["3 design concepts to choose from","Unlimited changes","Logo cleanup and color matching","Priority: first draft in 1 business day"]', 1, NULL, 3)
) AS s(code, name, description, price_cents, features, design_days, revisions, sort_order)
JOIN products p ON p.code = 'business-cards'
ON CONFLICT (product_id, code) DO NOTHING;
