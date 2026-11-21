-- Autovacuum on the high-churn monitor tables: vacuum after 2% dead rows and analyze after 1% changes (defaults 20% and
-- 10%), so space freed by hourly retention cleanup is reused steadily. Changing storage parameters needs table ownership:
-- a role that does not own a table gets a WARNING (printed by the migration runner) and the table keeps its settings (the owner can apply the same
-- ALTER TABLE). A table that stays locked past the lock timeout is skipped the same way, so a deploy never waits.
DO $$
DECLARE
  target text;
  -- Restored at the end so the short timeout never applies to later migrations in this transaction.
  previous_lock_timeout text := current_setting('lock_timeout');
BEGIN
  FOREACH target IN ARRAY ARRAY['monitor_results', 'monitor_aggregates', 'monitor_cycles'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = current_schema() AND tablename = target
        AND pg_has_role(current_user, tableowner, 'USAGE')
    ) THEN
      RAISE WARNING 'autovacuum settings for % not applied: % does not own it', target, current_user;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM set_config('lock_timeout', '5s', true);
      EXECUTE format(
        'ALTER TABLE %I SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01)',
        target
      );
    EXCEPTION WHEN lock_not_available THEN
      RAISE WARNING 'autovacuum settings for % not applied: table is locked', target;
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', previous_lock_timeout, true);
END
$$;
