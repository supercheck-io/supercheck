ALTER TABLE "project_variables" ADD COLUMN "type" varchar(20) DEFAULT 'variable' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_variables" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "project_variables" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "project_variables" ADD COLUMN "mime_type" varchar(255);--> statement-breakpoint
ALTER TABLE "project_variables" ADD COLUMN "storage_path" text;--> statement-breakpoint
-- Backfill: set type='secret' for existing secret variables
UPDATE "project_variables" SET "type" = 'secret' WHERE "is_secret" = true;