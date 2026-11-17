-- supercheck:no-transaction
-- Serves the channel list's newest-delivery-per-provider read (provider IN (...) ORDER BY provider, sent_at DESC).
-- Built CONCURRENTLY so alert inserts are not blocked; the runner executes this file outside its migration
-- transaction and drops an INVALID index left by an interrupted build before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "alert_history_provider_sent_at_idx" ON "alert_history" USING btree ("provider","sent_at" DESC NULLS FIRST);
