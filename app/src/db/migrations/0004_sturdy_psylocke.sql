ALTER TABLE "status_pages" ADD COLUMN "language" varchar(10) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD COLUMN "max_status_page_subscribers" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
UPDATE "plan_limits"
SET "max_status_page_subscribers" = CASE
	WHEN "plan" = 'plus' THEN 500
	WHEN "plan" = 'pro' THEN 5000
	WHEN "plan" = 'unlimited' THEN 999999
	ELSE "max_status_page_subscribers"
END;