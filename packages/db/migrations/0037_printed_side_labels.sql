-- Printed side names without "Full Color". Only names still as seeded change, so an edit in the admin stays.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
UPDATE option_values v
SET label = CASE v.label
  WHEN 'Full Color, Front and Back' THEN 'Front and Back'
  WHEN 'Full Color Front, Blank Back' THEN 'Front Only, Blank Back'
  WHEN 'Full Color, Same Artwork Both Sides' THEN 'Same Artwork Both Sides'
END
FROM option_groups g
WHERE g.id = v.group_id
  AND g.code = 'printed_side'
  AND v.label IN ('Full Color, Front and Back', 'Full Color Front, Blank Back', 'Full Color, Same Artwork Both Sides');
