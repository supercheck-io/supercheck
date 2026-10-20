-- Deploy this migration before the conflict-safe aggregation writer.
-- Keep an audit copy of superseded rows; monitor deletion also removes their copies.
-- Bounded lock: a busy/large table fails atomically for a later maintenance retry.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "monitor_aggregates" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS "monitor_aggregate_dedup_audit" (LIKE "monitor_aggregates" INCLUDING DEFAULTS);
ALTER TABLE "monitor_aggregate_dedup_audit"
  ADD PRIMARY KEY ("id"),
  ADD CONSTRAINT "monitor_aggregate_dedup_audit_monitor_fk"
    FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "monitor_aggregate_dedup_audit_monitor_idx"
  ON "monitor_aggregate_dedup_audit" ("monitor_id");
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "monitor_id", "period_type", "period_start"
    ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
  ) AS position
  FROM "monitor_aggregates" WHERE "location" IS NULL
), removed AS (
  DELETE FROM "monitor_aggregates" AS aggregate
  USING ranked WHERE aggregate."id" = ranked."id" AND ranked.position > 1
  RETURNING aggregate.*
)
INSERT INTO "monitor_aggregate_dedup_audit" SELECT * FROM removed;
CREATE UNIQUE INDEX "monitor_aggregates_combined_unique_idx"
  ON "monitor_aggregates" ("monitor_id", "period_type", "period_start")
  WHERE "location" IS NULL;
