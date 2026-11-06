-- Turnaround becomes a range. The days set so far stay as the latest day, so no promised date moves; the
-- earliest starts one day before, for the shop to adjust in the admin (open issue O17).
ALTER TABLE "turnaround_options" ADD COLUMN "min_business_days" integer;--> statement-breakpoint
UPDATE "turnaround_options" SET "min_business_days" = GREATEST("business_days" - 1, 1);--> statement-breakpoint
ALTER TABLE "turnaround_options" ALTER COLUMN "min_business_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "turnaround_options" ADD CONSTRAINT "turnaround_options_min_days_check" CHECK ("turnaround_options"."min_business_days" between 1 and "turnaround_options"."business_days");