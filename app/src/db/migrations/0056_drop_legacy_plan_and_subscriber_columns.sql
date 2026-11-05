-- Drops the unused plan column plan_limits.sso_enabled and the legacy plaintext
-- status_page_subscribers.webhook_secret (webhook_secret_encrypted replaced it).
-- status_page_subscribers.unsubscribe_token and its index are KEPT for one more release so unsubscribe links
-- already emailed by releases before 1.6 keep working; a later release drops them.
-- scripts/db-migrate.js encrypts every legacy plaintext webhook secret into webhook_secret_encrypted
-- immediately before this file runs (it needs SECRET_ENCRYPTION_KEY). The guard below is the backstop: it
-- stops the deploy rather than lose a signing secret that was never encrypted.
-- Every statement is idempotent, so a database where an earlier revision of this file already ran re-applies it safely;
-- the first two statements restore the unsubscribe_token column and index that revision dropped (its old values stay gone).
-- DEPLOY NOTE: this drops columns the previous release still reads. Deploy with workers scaled to 0 or in a
-- short maintenance window, and do not roll back to the previous image after this migration has run.
ALTER TABLE "status_page_subscribers" ADD COLUMN IF NOT EXISTS "unsubscribe_token" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_page_subscribers_unsubscribe_token_idx" ON "status_page_subscribers" USING btree ("unsubscribe_token") WHERE "unsubscribe_token" IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  plaintext_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'status_page_subscribers' AND column_name = 'webhook_secret'
  ) THEN
    EXECUTE 'SELECT count(*) FROM status_page_subscribers WHERE webhook_secret IS NOT NULL AND webhook_secret_encrypted IS NULL' INTO plaintext_count;
    IF plaintext_count > 0 THEN
      RAISE EXCEPTION '% status page webhook subscribers still have a plaintext signing secret that was not encrypted; set SECRET_ENCRYPTION_KEY and run scripts/db-migrate.js again', plaintext_count;
    END IF;
  END IF;
END
$$;--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_subscribers" DROP COLUMN IF EXISTS "webhook_secret";--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "plan_limits" DROP COLUMN IF EXISTS "sso_enabled";
