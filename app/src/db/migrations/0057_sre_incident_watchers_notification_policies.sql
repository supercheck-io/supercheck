-- Forward-only. Apply before deploying the app; older app versions ignore the new tables and column.
CREATE TABLE IF NOT EXISTS "sre_incident_watchers" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "incident_id" uuid NOT NULL REFERENCES "sre_incidents"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sre_incident_watchers_incident_user_unique_idx" ON "sre_incident_watchers" USING btree ("incident_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_incident_watchers_user_id_idx" ON "sre_incident_watchers" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_policies" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "email_service_owners_on_sev12" boolean DEFAULT false NOT NULL,
  "renotify_unacked_minutes" integer,
  "auto_investigate_on_open" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_policies_renotify_range_check" CHECK ("renotify_unacked_minutes" IS NULL OR ("renotify_unacked_minutes" BETWEEN 5 AND 1440))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_policies_project_unique_idx" ON "notification_policies" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_policies_organization_id_idx" ON "notification_policies" USING btree ("organization_id");
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "renotified_at" timestamp with time zone;
