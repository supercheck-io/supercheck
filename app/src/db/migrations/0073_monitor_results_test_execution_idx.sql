-- supercheck:no-transaction
-- Serves the tenancy lookup `monitor_results.test_execution_id = $1` (report access checks), which had no index and
-- scanned the whole table. NULL ids (non-synthetic results) are not indexed. Built CONCURRENTLY so result writes
-- are not blocked; the runner executes this file outside its migration transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "monitor_results_test_execution_id_idx" ON "monitor_results" USING btree ("test_execution_id") WHERE "monitor_results"."test_execution_id" IS NOT NULL;
