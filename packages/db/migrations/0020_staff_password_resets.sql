CREATE TABLE "staff_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_password_resets" ADD CONSTRAINT "staff_password_resets_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_password_resets_token_hash_key" ON "staff_password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_password_resets_staff_idx" ON "staff_password_resets" USING btree ("staff_user_id");