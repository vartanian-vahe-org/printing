CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"display_style" text DEFAULT 'dropdown' NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_groups_product_code_key" UNIQUE("product_id","code"),
	CONSTRAINT "option_groups_display_style_check" CHECK ("option_groups"."display_style" in ('dropdown', 'radio', 'swatch'))
);
--> statement-breakpoint
CREATE TABLE "option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_values_group_code_key" UNIQUE("group_id","code")
);
--> statement-breakpoint
CREATE TABLE "option_value_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"when_value_id" uuid NOT NULL,
	"target_group_id" uuid NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_value_rules_when_target_key" UNIQUE("when_value_id","target_group_id")
);
--> statement-breakpoint
CREATE TABLE "option_value_rule_allowed" (
	"rule_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	CONSTRAINT "option_value_rule_allowed_rule_id_value_id_pk" PRIMARY KEY("rule_id","value_id")
);
--> statement-breakpoint
CREATE TABLE "product_quantity_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"base_price_cents" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_quantity_tiers_product_quantity_key" UNIQUE("product_id","quantity"),
	CONSTRAINT "product_quantity_tiers_quantity_check" CHECK ("product_quantity_tiers"."quantity" > 0),
	CONSTRAINT "product_quantity_tiers_base_price_check" CHECK ("product_quantity_tiers"."base_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "option_value_prices" (
	"option_value_id" uuid NOT NULL,
	"quantity_tier_id" uuid NOT NULL,
	"upcharge_cents" integer NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_value_prices_option_value_id_quantity_tier_id_pk" PRIMARY KEY("option_value_id","quantity_tier_id")
);
--> statement-breakpoint
CREATE TABLE "production_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text NOT NULL,
	"cutoff_time" time NOT NULL,
	"working_days" smallint[] NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_settings_single_row" CHECK ("production_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"transit_days_min" integer NOT NULL,
	"transit_days_max" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"free_over_cents" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_code_unique" UNIQUE("code"),
	CONSTRAINT "shipping_methods_transit_check" CHECK ("shipping_methods"."transit_days_min" > 0 and "shipping_methods"."transit_days_max" >= "shipping_methods"."transit_days_min"),
	CONSTRAINT "shipping_methods_price_check" CHECK ("shipping_methods"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_role_check" CHECK ("staff_users"."role" in ('owner', 'admin', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"supported_size_codes" text[] NOT NULL,
	"layout" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_product_code_key" UNIQUE("product_id","code")
);
--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_values" ADD CONSTRAINT "option_values_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_rules" ADD CONSTRAINT "option_value_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_rules" ADD CONSTRAINT "option_value_rules_when_value_id_option_values_id_fk" FOREIGN KEY ("when_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_rules" ADD CONSTRAINT "option_value_rules_target_group_id_option_groups_id_fk" FOREIGN KEY ("target_group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_rule_allowed" ADD CONSTRAINT "option_value_rule_allowed_rule_id_option_value_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."option_value_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_rule_allowed" ADD CONSTRAINT "option_value_rule_allowed_value_id_option_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_quantity_tiers" ADD CONSTRAINT "product_quantity_tiers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_prices" ADD CONSTRAINT "option_value_prices_option_value_id_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_value_prices" ADD CONSTRAINT "option_value_prices_quantity_tier_id_product_quantity_tiers_id_fk" FOREIGN KEY ("quantity_tier_id") REFERENCES "public"."product_quantity_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "option_values_one_default_per_group" ON "option_values" USING btree ("group_id") WHERE "option_values"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "product_quantity_tiers_one_default_per_product" ON "product_quantity_tiers" USING btree ("product_id") WHERE "product_quantity_tiers"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_methods_one_default" ON "shipping_methods" USING btree ("is_default") WHERE "shipping_methods"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users" USING btree (lower("email"));