CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");