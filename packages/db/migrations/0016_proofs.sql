ALTER TABLE "order_items" DROP CONSTRAINT "order_items_proof_status_check";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "preflight" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "print_key" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "proof_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "proof_approved_by" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_proof_status_check" CHECK ("order_items"."proof_status" in ('pending', 'awaiting_customer', 'needs_new_file', 'approved'));