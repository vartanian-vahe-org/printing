CREATE TABLE "library_quantities" (
	"quantity" integer PRIMARY KEY NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_quantities_quantity_check" CHECK ("library_quantities"."quantity" > 0)
);
--> statement-breakpoint
-- Quantities join the option library; every quantity a product sells today goes in.
INSERT INTO "library_quantities" ("quantity") SELECT DISTINCT "quantity" FROM "product_quantity_tiers";--> statement-breakpoint
ALTER TABLE "product_quantity_tiers" ADD CONSTRAINT "product_quantity_tiers_quantity_library_quantities_quantity_fk" FOREIGN KEY ("quantity") REFERENCES "public"."library_quantities"("quantity") ON DELETE restrict ON UPDATE cascade;