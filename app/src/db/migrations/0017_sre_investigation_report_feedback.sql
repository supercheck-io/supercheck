CREATE TABLE IF NOT EXISTS "sre_investigation_report_feedback" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "report_id" uuid NOT NULL,
  "investigation_run_id" uuid NOT NULL,
  "incident_id" uuid,
  "accuracy" varchar(30) NOT NULL,
  "rejected_hypotheses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_investigation_report_feedback_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_report_feedback_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_report_feedback_report_fk"
    FOREIGN KEY ("report_id") REFERENCES "public"."sre_investigation_reports"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_report_feedback_run_fk"
    FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_report_feedback_incident_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "sre_investigation_report_feedback_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sre_investigation_report_feedback_report_user_unique_idx"
  ON "sre_investigation_report_feedback" USING btree ("report_id", "created_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_report_feedback_project_updated_idx"
  ON "sre_investigation_report_feedback" USING btree ("project_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_report_feedback_run_updated_idx"
  ON "sre_investigation_report_feedback" USING btree ("investigation_run_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_report_feedback_accuracy_idx"
  ON "sre_investigation_report_feedback" USING btree ("accuracy");
