ALTER TABLE "organization" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deletion_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "purge_after" timestamp with time zone;
