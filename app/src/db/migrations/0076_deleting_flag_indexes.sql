-- supercheck:no-transaction
-- Partial indexes: rows being deleted (a handful at any time) so the purge sweeper finds them without scanning jobs or
-- monitors, and saved-test report aliases by path so run deletion finds them without scanning reports. Built
-- CONCURRENTLY so writes are not blocked; the runner executes this file outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_deleting_idx" ON "jobs" USING btree ("id") WHERE deleting_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "monitors_deleting_idx" ON "monitors" USING btree ("id") WHERE deleting_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reports_test_report_path_idx" ON "reports" USING btree ("report_path") WHERE entity_type = 'test';
