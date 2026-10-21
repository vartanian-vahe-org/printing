-- Default sales tax rates for the default tax provider (docs/decisions.md T14).
-- PLACEHOLDER: California's statewide base rate only. District (city/county) taxes are NOT included,
-- so real rates are higher (often 8-10%+). Replace with a tax service before selling (docs/open-issues.md S7).
-- Data migration: runs once per environment. Insert-only (ON CONFLICT DO NOTHING).

INSERT INTO tax_rates (state, rate_bps, label, created_by)
VALUES ('CA', 725, 'California sales tax (state base rate, placeholder)', 'system:migration')
ON CONFLICT (state) DO NOTHING;
