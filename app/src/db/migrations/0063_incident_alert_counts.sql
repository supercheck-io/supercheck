-- Forward-only. Apply before deploying the app; older app versions ignore the columns.
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "alert_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "last_alert_at" timestamp with time zone;--> statement-breakpoint
-- Existing incidents start from the alerts already linked to them (none for a hand-created one).
UPDATE "sre_incidents" i
SET "alert_count" = COALESCE((SELECT count(*)::int FROM "sre_incident_alerts" a WHERE a."incident_id" = i."id"), 0),
    "last_alert_at" = (SELECT max(a."alert_fired_at") FROM "sre_incident_alerts" a WHERE a."incident_id" = i."id");
