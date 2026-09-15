CREATE TABLE IF NOT EXISTS "sre_investigation_reports" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "incident_id" uuid,
  "investigation_run_id" uuid NOT NULL,
  "report_version" varchar(40) DEFAULT 'sre-investigation-report.v1' NOT NULL,
  "title" varchar(300),
  "summary" text,
  "report_data" jsonb NOT NULL,
  "report_hash" varchar(64) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_investigation_reports_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_reports_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_reports_incident_fk"
    FOREIGN KEY ("incident_id") REFERENCES "public"."sre_incidents"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "sre_investigation_reports_run_fk"
    FOREIGN KEY ("investigation_run_id") REFERENCES "public"."sre_investigation_runs"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_investigation_reports_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_reports_run_created_at_idx"
  ON "sre_investigation_reports" USING btree ("investigation_run_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_reports_project_created_at_idx"
  ON "sre_investigation_reports" USING btree ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_reports_incident_created_at_idx"
  ON "sre_investigation_reports" USING btree ("incident_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_investigation_reports_active_run_idx"
  ON "sre_investigation_reports" USING btree ("investigation_run_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sre_investigation_reports_run_hash_unique_idx"
  ON "sre_investigation_reports" USING btree ("investigation_run_id", "report_hash");
