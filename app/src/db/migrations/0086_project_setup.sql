CREATE TABLE "project_setup_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"current_step" text,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skipped" text[] DEFAULT '{}'::text[] NOT NULL,
	"status_page_opt_out" boolean DEFAULT false NOT NULL,
	"locked_by_user_id" uuid,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"last_ai_run_at" timestamp with time zone,
	"scan_result" jsonb,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_setup_state_status_check" CHECK (status IN ('not_started', 'in_progress', 'completed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"persona" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_persona_check" CHECK (persona IS NULL OR persona IN ('sre', 'qa', 'developer', 'leader'))
);
--> statement-breakpoint
ALTER TABLE "project_setup_state" ADD CONSTRAINT "project_setup_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_setup_state" ADD CONSTRAINT "project_setup_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_setup_state" ADD CONSTRAINT "project_setup_state_locked_by_user_id_user_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_setup_state_project_id_idx" ON "project_setup_state" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_setup_state_organization_id_idx" ON "project_setup_state" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_setup_state_locked_by_user_id_idx" ON "project_setup_state" USING btree ("locked_by_user_id");