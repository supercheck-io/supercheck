ALTER TABLE "private_agent_jobs" ADD COLUMN "job_spec" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "private_agent_jobs" ADD COLUMN "result_summary" jsonb;