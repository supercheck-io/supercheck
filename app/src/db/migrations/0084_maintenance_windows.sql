-- Bounded lock: monitor_results takes constant inserts; a busy table fails atomically for a later retry.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "maintenance_window_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"window_id" uuid NOT NULL,
	"target_type" varchar(10) NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "maintenance_window_targets_target_type_check" CHECK ("maintenance_window_targets"."target_type" IN ('service', 'monitor'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"scope" varchar(10) NOT NULL,
	"recurrence" varchar(10) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"local_start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"weekdays" smallint[],
	"month_day" smallint,
	"occurrence_starts_at" timestamp with time zone,
	"occurrence_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_windows_scope_check" CHECK ("maintenance_windows"."scope" IN ('project', 'services', 'monitors')),
	CONSTRAINT "maintenance_windows_recurrence_check" CHECK ("maintenance_windows"."recurrence" IN ('once', 'daily', 'weekly', 'monthly')),
	CONSTRAINT "maintenance_windows_duration_check" CHECK ("maintenance_windows"."duration_minutes" BETWEEN 5 AND 10080),
	CONSTRAINT "maintenance_windows_month_day_check" CHECK ("maintenance_windows"."month_day" IS NULL OR "maintenance_windows"."month_day" BETWEEN 1 AND 28 OR "maintenance_windows"."month_day" = -1)
);
--> statement-breakpoint
ALTER TABLE "monitor_results" ADD COLUMN "in_maintenance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "maintenance_window_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_window_targets" ADD CONSTRAINT "maintenance_window_targets_window_id_maintenance_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."maintenance_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_window_targets_window_target_unique_idx" ON "maintenance_window_targets" USING btree ("window_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "maintenance_window_targets_target_idx" ON "maintenance_window_targets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "maintenance_windows_project_occurrence_idx" ON "maintenance_windows" USING btree ("project_id","occurrence_starts_at");--> statement-breakpoint
CREATE INDEX "maintenance_windows_organization_id_idx" ON "maintenance_windows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "maintenance_windows_created_by_user_id_idx" ON "maintenance_windows" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_maintenance_window_id_maintenance_windows_id_fk" FOREIGN KEY ("maintenance_window_id") REFERENCES "public"."maintenance_windows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_maintenance_window_id_idx" ON "incidents" USING btree ("maintenance_window_id");--> statement-breakpoint
RESET lock_timeout;
