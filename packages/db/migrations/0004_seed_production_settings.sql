-- Production settings: 2:00 PM Pacific cutoff, Monday-Friday, US federal holidays 2026-2027.
-- Source: docs/specs/business-card-mvp.md §5
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING),
-- so rows an admin has edited are never overwritten. Do not edit after it has been applied
-- to a shared environment; add a new migration instead.

INSERT INTO production_settings (id, timezone, cutoff_time, working_days, created_by)
VALUES (1, 'America/Los_Angeles', '14:00', '{1,2,3,4,5}', 'system:migration')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Weekend holidays use the federal observed date.
INSERT INTO holidays (date, name, created_by)
SELECT h.date::date, h.name, 'system:migration'
FROM (VALUES
    ('2026-01-01', 'New Year''s Day'),
    ('2026-01-19', 'Martin Luther King Jr. Day'),
    ('2026-02-16', 'Presidents'' Day'),
    ('2026-05-25', 'Memorial Day'),
    ('2026-06-19', 'Juneteenth'),
    ('2026-07-03', 'Independence Day (observed)'),
    ('2026-09-07', 'Labor Day'),
    ('2026-10-12', 'Columbus Day'),
    ('2026-11-11', 'Veterans Day'),
    ('2026-11-26', 'Thanksgiving Day'),
    ('2026-12-25', 'Christmas Day'),
    ('2027-01-01', 'New Year''s Day'),
    ('2027-01-18', 'Martin Luther King Jr. Day'),
    ('2027-02-15', 'Presidents'' Day'),
    ('2027-05-31', 'Memorial Day'),
    ('2027-06-18', 'Juneteenth (observed)'),
    ('2027-07-05', 'Independence Day (observed)'),
    ('2027-09-06', 'Labor Day'),
    ('2027-10-11', 'Columbus Day'),
    ('2027-11-11', 'Veterans Day'),
    ('2027-11-25', 'Thanksgiving Day'),
    ('2027-12-24', 'Christmas Day (observed)'),
    ('2027-12-31', 'New Year''s Day 2028 (observed)')
) AS h(date, name)
ON CONFLICT (date) DO NOTHING;
