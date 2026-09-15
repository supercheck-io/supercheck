ALTER TABLE "organization" ADD COLUMN "polar_webhook_timestamp" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "polar_webhook_event_key" text;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "polar_retired_subscription_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
