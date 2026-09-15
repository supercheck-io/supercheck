CREATE TABLE IF NOT EXISTS "sre_evidence_graph_focused_views" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "query" varchar(200) DEFAULT '' NOT NULL,
  "node_type" varchar(30) DEFAULT 'all' NOT NULL,
  "incident_node_id" varchar(80) DEFAULT 'all' NOT NULL,
  "visibility" varchar(20) DEFAULT 'project' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "view_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sre_evidence_graph_focused_views_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_evidence_graph_focused_views_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sre_evidence_graph_focused_views_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_evidence_graph_focused_views_project_status_updated_idx"
  ON "sre_evidence_graph_focused_views" USING btree ("project_id", "status", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sre_evidence_graph_focused_views_created_by_idx"
  ON "sre_evidence_graph_focused_views" USING btree ("created_by_user_id", "updated_at");
