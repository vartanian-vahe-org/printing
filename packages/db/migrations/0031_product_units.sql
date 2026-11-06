ALTER TABLE "products" ADD COLUMN "unit_name" text DEFAULT 'item' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_name_plural" text DEFAULT 'items' NOT NULL;