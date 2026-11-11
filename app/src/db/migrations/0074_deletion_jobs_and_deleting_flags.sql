CREATE TABLE "deletion_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"organization_id" uuid,
	"state" varchar(20) DEFAULT 'queued' NOT NULL,
	"phase" varchar(40),
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"last_error" text,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "deletion_jobs_scope_check" CHECK ("deletion_jobs"."scope" IN ('job', 'monitor', 'project', 'organization')),
	CONSTRAINT "deletion_jobs_state_check" CHECK ("deletion_jobs"."state" IN ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "deleting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "deleting_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_jobs_active_target_idx" ON "deletion_jobs" USING btree ("scope","target_id") WHERE state <> 'completed';--> statement-breakpoint
CREATE INDEX "deletion_jobs_pending_idx" ON "deletion_jobs" USING btree ("state","next_attempt_at") WHERE state IN ('queued', 'running');
