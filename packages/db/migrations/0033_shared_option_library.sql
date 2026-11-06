CREATE TABLE "product_option_values" (
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"addon_percent" numeric(6, 2) DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_values_product_id_value_id_pk" PRIMARY KEY("product_id","value_id"),
	CONSTRAINT "product_option_values_addon_percent_check" CHECK ("product_option_values"."addon_percent" between -90 and 500)
);
--> statement-breakpoint
ALTER TABLE "option_value_rules" DROP CONSTRAINT "option_value_rules_when_target_key";--> statement-breakpoint
-- Options move to one shared library. What each product did with them (hidden, default, add-on percent)
-- moves to product_option_values; prices, turnaround and rules stay with the product and now point at the
-- shared option. Groups and options with the same code become one, keeping the oldest label and details.
INSERT INTO "product_option_values" ("product_id", "group_id", "value_id", "is_active", "is_default", "addon_percent", "created_by", "updated_by", "created_at", "updated_at")
SELECT g."product_id", v."group_id", v."id", v."is_active", v."is_default", v."addon_percent", v."created_by", v."updated_by", v."created_at", v."updated_at"
FROM "option_values" v JOIN "option_groups" g ON g."id" = v."group_id";--> statement-breakpoint
CREATE TEMP TABLE "group_map" ON COMMIT DROP AS
SELECT "id" AS "old_id", first_value("id") OVER (PARTITION BY "code" ORDER BY "created_at", "id") AS "new_id" FROM "option_groups";--> statement-breakpoint
CREATE TEMP TABLE "value_map" ON COMMIT DROP AS
SELECT v."id" AS "old_id", first_value(v."id") OVER (PARTITION BY g."code", v."code" ORDER BY v."created_at", v."id") AS "new_id"
FROM "option_values" v JOIN "option_groups" g ON g."id" = v."group_id";--> statement-breakpoint
UPDATE "product_option_values" t SET "value_id" = m."new_id" FROM "value_map" m WHERE t."value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "product_option_values" t SET "group_id" = m."new_id" FROM "group_map" m WHERE t."group_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "core_prices" t SET "size_value_id" = m."new_id" FROM "value_map" m WHERE t."size_value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "core_prices" t SET "paper_value_id" = m."new_id" FROM "value_map" m WHERE t."paper_value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "core_prices" t SET "printed_side_value_id" = m."new_id" FROM "value_map" m WHERE t."printed_side_value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "turnaround_options" t SET "option_value_id" = m."new_id" FROM "value_map" m WHERE t."option_value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "option_value_rules" t SET "when_value_id" = m."new_id" FROM "value_map" m WHERE t."when_value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "option_value_rules" t SET "target_group_id" = m."new_id" FROM "group_map" m WHERE t."target_group_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
UPDATE "option_value_rule_allowed" t SET "value_id" = m."new_id" FROM "value_map" m WHERE t."value_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
DELETE FROM "option_values" v USING "value_map" m WHERE v."id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
ALTER TABLE "option_groups" DROP CONSTRAINT "option_groups_product_code_key";--> statement-breakpoint
UPDATE "option_values" v SET "group_id" = m."new_id" FROM "group_map" m WHERE v."group_id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
DELETE FROM "option_groups" g USING "group_map" m WHERE g."id" = m."old_id" AND m."old_id" <> m."new_id";--> statement-breakpoint
ALTER TABLE "option_values" DROP CONSTRAINT "option_values_addon_percent_check";--> statement-breakpoint
ALTER TABLE "option_groups" DROP CONSTRAINT "option_groups_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX "option_values_one_default_per_group";--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_value_id_option_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_one_default_per_group" ON "product_option_values" USING btree ("product_id","group_id") WHERE "product_option_values"."is_default";--> statement-breakpoint
ALTER TABLE "option_groups" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "option_values" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "option_values" DROP COLUMN "is_default";--> statement-breakpoint
ALTER TABLE "option_values" DROP COLUMN "addon_percent";--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_code_key" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "option_value_rules" ADD CONSTRAINT "option_value_rules_product_when_target_key" UNIQUE("product_id","when_value_id","target_group_id");