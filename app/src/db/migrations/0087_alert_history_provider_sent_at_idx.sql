-- supercheck:no-transaction
-- Serves the newest alert per channel (provider = $1 AND sent_at IS NOT NULL ORDER BY sent_at DESC NULLS LAST LIMIT 1),
-- one probe per channel. NULLS LAST is deliberate: alert_history_sent_at_idx cannot give that order, so the planner
-- cannot pick it and scan the table for a quiet channel. Built CONCURRENTLY so alert inserts are not blocked; the
-- runner executes this file outside its migration transaction and drops an INVALID leftover before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "alert_history_provider_sent_at_idx" ON "alert_history" USING btree ("provider","sent_at" DESC NULLS LAST);
