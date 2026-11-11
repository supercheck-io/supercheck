-- supercheck:no-transaction
-- Partial indexes over rows being deleted (a handful at any time), so the purge sweeper finds them without scanning
-- jobs or monitors. Built CONCURRENTLY so writes are not blocked; the runner executes this file outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_deleting_idx" ON "jobs" USING btree ("id") WHERE deleting_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "monitors_deleting_idx" ON "monitors" USING btree ("id") WHERE deleting_at IS NOT NULL;
