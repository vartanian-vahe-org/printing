CREATE TABLE "core_prices" (
	"size_value_id" uuid NOT NULL,
	"paper_value_id" uuid NOT NULL,
	"printed_side_value_id" uuid NOT NULL,
	"quantity_tier_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_prices_pk" PRIMARY KEY("size_value_id","paper_value_id","printed_side_value_id","quantity_tier_id"),
	CONSTRAINT "core_prices_price_check" CHECK ("core_prices"."price_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "option_values" ADD COLUMN "addon_percent" numeric(6, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core_prices" ADD CONSTRAINT "core_prices_size_value_id_option_values_id_fk" FOREIGN KEY ("size_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_prices" ADD CONSTRAINT "core_prices_paper_value_id_option_values_id_fk" FOREIGN KEY ("paper_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_prices" ADD CONSTRAINT "core_prices_printed_side_value_id_option_values_id_fk" FOREIGN KEY ("printed_side_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_prices" ADD CONSTRAINT "core_prices_quantity_tier_id_product_quantity_tiers_id_fk" FOREIGN KEY ("quantity_tier_id") REFERENCES "public"."product_quantity_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_addon_percent_check" CHECK ("option_values"."addon_percent" between -90 and 500);