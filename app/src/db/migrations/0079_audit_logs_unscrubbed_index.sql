-- supercheck:no-transaction
-- Rows whose emails are not yet scrubbed, so the audit scrub walks only unfinished rows. Built CONCURRENTLY so audit writes are not blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_unscrubbed_created_idx" ON "audit_logs" USING btree ("created_at") WHERE (details IS NULL OR NOT (details ? 'emailsScrubbed'));
