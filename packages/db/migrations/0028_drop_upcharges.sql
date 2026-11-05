ALTER TABLE "option_value_prices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "option_value_prices" CASCADE;--> statement-breakpoint
ALTER TABLE "product_quantity_tiers" DROP CONSTRAINT "product_quantity_tiers_base_price_check";--> statement-breakpoint
ALTER TABLE "product_quantity_tiers" DROP COLUMN "base_price_cents";