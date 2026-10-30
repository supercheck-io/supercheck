-- Forward-only. Apply before deploying the app; older app versions ignore the columns.
-- One alert event row is reused per source and alert type, and each new failure refreshes it,
-- so every incident keeps its own copy of the alert as it was when linked.
ALTER TABLE "sre_incident_alerts" ADD COLUMN IF NOT EXISTS "alert_title" text;
--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD COLUMN IF NOT EXISTS "alert_description" text;
--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD COLUMN IF NOT EXISTS "alert_severity" varchar(10);
--> statement-breakpoint
ALTER TABLE "sre_incident_alerts" ADD COLUMN IF NOT EXISTS "alert_fired_at" timestamp;
