-- Forward-only. Retain this table and trigger when rolling back application code.
-- Drain pre-protocol workers before enabling deletion with the new release.
CREATE TABLE IF NOT EXISTS run_callbacks (
  run_id uuid PRIMARY KEY,
  owner uuid NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  revoked_at timestamptz,
  bucket text,
  cleanup_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS run_callbacks_cleanup_idx ON run_callbacks (cleanup_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fence_deleted_run_callback() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE run_callbacks SET revoked_at = COALESCE(revoked_at, now()), cleanup_at = now()
  WHERE run_id = OLD.id;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS fence_deleted_run_callback ON runs;
--> statement-breakpoint
CREATE TRIGGER fence_deleted_run_callback BEFORE DELETE ON runs
FOR EACH ROW EXECUTE FUNCTION fence_deleted_run_callback();
