ALTER TABLE "orders" ADD COLUMN "ship_by" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deliver_from" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deliver_to" date;--> statement-breakpoint
CREATE INDEX "orders_ship_by_idx" ON "orders" USING btree ("ship_by");