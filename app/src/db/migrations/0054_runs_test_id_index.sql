-- supercheck:no-transaction
-- Serve the playground run lookups (runs.metadata->>'testId', newest first) without a sequential scan of
-- runs. Built CONCURRENTLY so writes to runs are not blocked; the runner executes this file outside its
-- migration transaction and drops an INVALID index left by an interrupted build before retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS runs_metadata_test_id_created_at_idx ON runs ((metadata->>'testId'), created_at DESC);
