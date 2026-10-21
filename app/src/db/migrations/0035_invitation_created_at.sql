-- Better Auth 1.7 reads and writes invitation.created_at.
-- Additive with a default, so code from before this release keeps inserting invitations unchanged.
-- Existing rows are backfilled with the migration time.
--
-- The migrator runs every file, plus verification and seeding, in one transaction, so a
-- transaction-local timeout would outlive this migration. Capture the timeouts in force, apply
-- bounded ones for the ALTER, and put the captured values back afterwards. (RESET would restore
-- the server default instead, discarding any value the connection had set.)
DO $$
DECLARE
  previous_lock_timeout text := current_setting('lock_timeout');
  previous_statement_timeout text := current_setting('statement_timeout');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '30s', true);
  ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
  PERFORM set_config('lock_timeout', previous_lock_timeout, true);
  PERFORM set_config('statement_timeout', previous_statement_timeout, true);
END
$$;
