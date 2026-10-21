ALTER TABLE "staff_users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "totp_enabled_at" timestamp with time zone;