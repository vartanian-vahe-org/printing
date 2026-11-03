CREATE TABLE "turnaround_options" (
	"option_value_id" uuid NOT NULL,
	"quantity_tier_id" uuid NOT NULL,
	"business_days" integer NOT NULL,
	"price_percent" numeric(6, 2) NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turnaround_options_option_value_id_quantity_tier_id_pk" PRIMARY KEY("option_value_id","quantity_tier_id"),
	CONSTRAINT "turnaround_options_days_check" CHECK ("turnaround_options"."business_days" between 1 and 60),
	CONSTRAINT "turnaround_options_percent_check" CHECK ("turnaround_options"."price_percent" between -90 and 500)
);
--> statement-breakpoint
ALTER TABLE "turnaround_options" ADD CONSTRAINT "turnaround_options_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnaround_options" ADD CONSTRAINT "turnaround_options_quantity_tier_id_product_quantity_tiers_id_fk" FOREIGN KEY ("quantity_tier_id") REFERENCES "public"."product_quantity_tiers"("id") ON DELETE cascade ON UPDATE no action;