-- Forward-only. Apply before deploying the app. Retain these columns and the feedback table when rolling back application code.
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "assignee_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "acknowledged_by_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "commander_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "mitigated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "resolution_summary" text;
--> statement-breakpoint
ALTER TABLE "sre_incidents" ADD COLUMN IF NOT EXISTS "postmortem" jsonb;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sre_incidents_resolution_summary_length_check') THEN
    ALTER TABLE "sre_incidents" ADD CONSTRAINT "sre_incidents_resolution_summary_length_check" CHECK ("resolution_summary" IS NULL OR char_length("resolution_summary") <= 4000);
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_incidents_project_assignee_active_idx" ON "sre_incidents" ("project_id", "assignee_user_id") WHERE "status" <> 'resolved';
--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD COLUMN IF NOT EXISTS "steps" jsonb;
--> statement-breakpoint
ALTER TABLE "sre_investigation_runs" ADD COLUMN IF NOT EXISTS "hypotheses" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sre_investigation_feedback" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "incident_id" uuid NOT NULL REFERENCES "sre_incidents"("id") ON DELETE CASCADE,
  "investigation_run_id" uuid NOT NULL REFERENCES "sre_investigation_runs"("id") ON DELETE CASCADE,
  "hypothesis_key" varchar(100),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "verdict" varchar(10) NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_investigation_feedback_verdict_check" CHECK ("verdict" IN ('right', 'wrong')),
  CONSTRAINT "sre_investigation_feedback_note_length_check" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_feedback_incident_created_idx" ON "sre_investigation_feedback" ("incident_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_feedback_run_idx" ON "sre_investigation_feedback" ("investigation_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_feedback_project_created_idx" ON "sre_investigation_feedback" ("project_id", "created_at");
