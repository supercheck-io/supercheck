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
	"owner_token" uuid,
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
CREATE INDEX "deletion_jobs_pending_idx" ON "deletion_jobs" USING btree ("state","next_attempt_at") WHERE state IN ('queued', 'running');--> statement-breakpoint
-- Fences run creation against deletion for every insert path (scheduler, API and CLI triggers, MCP, retries) in one
-- place. FOR KEY SHARE waits while the delete request holds the job row FOR UPDATE and then reads the flag it set; an
-- insert that wins instead makes the request wait for it, so the request's run cancellation always sees that run.
CREATE OR REPLACE FUNCTION runs_reject_deleting_job() RETURNS trigger AS $$
DECLARE flagged timestamptz;
BEGIN
  IF NEW.job_id IS NULL THEN RETURN NEW; END IF;
  SELECT deleting_at INTO flagged FROM public.jobs WHERE id = NEW.job_id FOR KEY SHARE;
  IF flagged IS NOT NULL THEN
    RAISE EXCEPTION 'job % is being deleted', NEW.job_id USING ERRCODE = 'DL001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER runs_reject_deleting_job BEFORE INSERT ON runs FOR EACH ROW EXECUTE FUNCTION runs_reject_deleting_job();
--> statement-breakpoint
-- Same fence for status page links: a monitor being deleted must never be attached to a public status page.
CREATE OR REPLACE FUNCTION status_page_links_reject_deleting_monitor() RETURNS trigger AS $$
DECLARE flagged timestamptz;
BEGIN
  SELECT deleting_at INTO flagged FROM public.monitors WHERE id = NEW.monitor_id FOR KEY SHARE;
  IF flagged IS NOT NULL THEN
    RAISE EXCEPTION 'monitor % is being deleted', NEW.monitor_id USING ERRCODE = 'DL001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER status_page_links_reject_deleting_monitor BEFORE INSERT ON status_page_component_monitors FOR EACH ROW EXECUTE FUNCTION status_page_links_reject_deleting_monitor();
