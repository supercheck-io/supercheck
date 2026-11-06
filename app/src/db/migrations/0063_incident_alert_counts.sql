-- Forward-only. Apply before deploying the app; older app versions ignore the columns.
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "alert_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "last_alert_at" timestamp with time zone;--> statement-breakpoint
-- Existing incidents start from the alerts already linked to them.
UPDATE "sre_incidents" i
SET "alert_count" = GREATEST(1, a.n), "last_alert_at" = a.last_at
FROM (
  SELECT "incident_id", count(*)::int AS n, max("alert_fired_at") AS last_at
  FROM "sre_incident_alerts"
  GROUP BY "incident_id"
) a
WHERE a."incident_id" = i."id";
