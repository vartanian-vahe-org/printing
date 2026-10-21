CREATE TABLE "store_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"store_name" text NOT NULL,
	"support_email" text NOT NULL,
	"order_notification_emails" text[] NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_single_row" CHECK ("store_settings"."id" = 1)
);
