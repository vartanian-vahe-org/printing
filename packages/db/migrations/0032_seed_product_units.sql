-- What customers call the first product, moved from the storefront code so each product can have its own.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
UPDATE products SET unit_name = 'card', unit_name_plural = 'cards' WHERE code = 'business-cards';
