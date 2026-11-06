CREATE TABLE "product_design_services" (
	"product_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"display_name" text,
	"price_cents" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_design_services_product_id_tier_id_pk" PRIMARY KEY("product_id","tier_id"),
	CONSTRAINT "product_design_services_price_check" CHECK ("product_design_services"."price_cents" >= 0)
);
--> statement-breakpoint
-- Design packages move to one library. Each product keeps offering what it did, at its price; packages with the
-- same code become one, keeping the oldest as the standard, and a different name stays as that product's own.
CREATE TEMP TABLE "tier_map" ON COMMIT DROP AS
SELECT "id" AS "old_id", first_value("id") OVER (PARTITION BY "code" ORDER BY "created_at", "id") AS "new_id" FROM "design_service_tiers";--> statement-breakpoint
INSERT INTO "product_design_services" ("product_id", "tier_id", "display_name", "price_cents", "is_active", "created_by", "updated_by", "created_at", "updated_at")
SELECT t."product_id", m."new_id", NULLIF(t."name", c."name"), t."price_cents", t."is_active", t."created_by", t."updated_by", t."created_at", t."updated_at"
FROM "design_service_tiers" t JOIN "tier_map" m ON m."old_id" = t."id" JOIN "design_service_tiers" c ON c."id" = m."new_id";--> statement-breakpoint
DELETE FROM "design_service_tiers" t USING "tier_map" m WHERE t."id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
ALTER TABLE "design_service_tiers" DROP CONSTRAINT "design_service_tiers_product_code_key";--> statement-breakpoint
ALTER TABLE "design_service_tiers" DROP CONSTRAINT "design_service_tiers_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "product_design_services" ADD CONSTRAINT "product_design_services_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_design_services" ADD CONSTRAINT "product_design_services_tier_id_design_service_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."design_service_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_service_tiers" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "design_service_tiers" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "design_service_tiers" ADD CONSTRAINT "design_service_tiers_code_key" UNIQUE("code");