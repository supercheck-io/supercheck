-- supercheck:no-transaction
-- Partial indexes over the few organizations and projects awaiting purge, so the sweep finds due and reminder-eligible
-- rows without scanning either table. Built CONCURRENTLY so writes are not blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_deletion_purge_after_idx" ON "organization" USING btree ("deletion_purge_after") WHERE deletion_requested_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "projects_purge_after_idx" ON "projects" USING btree ("purge_after") WHERE deleted_at IS NOT NULL;
