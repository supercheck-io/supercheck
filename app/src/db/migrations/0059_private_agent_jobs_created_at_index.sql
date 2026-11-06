-- supercheck:no-transaction
-- Serves the private_agent_jobs retention purge (created_at, id keyset paging). Built CONCURRENTLY so job
-- inserts are not blocked; the runner executes this file outside its migration transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "private_agent_jobs_created_at_idx" ON "private_agent_jobs" USING btree ("created_at","id");
