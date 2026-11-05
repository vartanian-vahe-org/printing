-- Page text of the first product, moved from the storefront code so the admin can edit it.
-- Data migration: runs once per environment. Do not edit after it has been applied to a shared
-- environment; add a new migration instead.
UPDATE products
SET description = 'Pick your options, then upload a design, use a template, or let us design it for you.',
    seo_title = 'Custom Business Cards',
    seo_description = 'Choose size, paper and finish for your business cards, pick a template, add your details and preview the card in 3D.'
WHERE code = 'business-cards';
