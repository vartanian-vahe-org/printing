CREATE TABLE "design_service_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"design_days" integer NOT NULL,
	"revisions" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_service_tiers_product_code_key" UNIQUE("product_id","code"),
	CONSTRAINT "design_service_tiers_price_check" CHECK ("design_service_tiers"."price_cents" >= 0),
	CONSTRAINT "design_service_tiers_days_check" CHECK ("design_service_tiers"."design_days" between 1 and 60),
	CONSTRAINT "design_service_tiers_revisions_check" CHECK ("design_service_tiers"."revisions" is null or "design_service_tiers"."revisions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "template_facets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_facets_product_code_key" UNIQUE("product_id","code")
);
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_proof_status_check";--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "tags" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "design_service_tiers" ADD CONSTRAINT "design_service_tiers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_facets" ADD CONSTRAINT "template_facets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_proof_status_check" CHECK ("order_items"."proof_status" in ('pending', 'awaiting_design', 'awaiting_customer', 'needs_new_file', 'approved'));