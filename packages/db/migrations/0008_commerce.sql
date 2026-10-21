CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_state_check" CHECK ("tax_rates"."state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "tax_rates_rate_check" CHECK ("tax_rates"."rate_bps" between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 100001 CACHE 1),
	"email" text NOT NULL,
	"customer_id" uuid,
	"status" text DEFAULT 'placed' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"shipping_method" jsonb NOT NULL,
	"tax" jsonb NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"access_token_hash" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('placed', 'in_production', 'shipped', 'completed', 'cancelled')),
	CONSTRAINT "orders_payment_status_check" CHECK ("orders"."payment_status" in ('unpaid', 'paid', 'refunded')),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_cents" = "orders"."subtotal_cents" + "orders"."shipping_cents" + "orders"."tax_cents" and "orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_name" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"proof_status" text DEFAULT 'pending' NOT NULL,
	"production_status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_proof_status_check" CHECK ("order_items"."proof_status" in ('pending', 'awaiting_customer', 'approved')),
	CONSTRAINT "order_items_production_status_check" CHECK ("order_items"."production_status" in ('waiting', 'in_production', 'printed', 'shipped'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('pending', 'succeeded', 'failed', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"service" text,
	"tracking_number" text NOT NULL,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_state_key" ON "tax_rates" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_token_hash_key" ON "carts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_key" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");