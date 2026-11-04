-- Drops the unused plan column plan_limits.sso_enabled and the legacy subscriber columns
-- status_page_subscribers.unsubscribe_token / webhook_secret (signed unsubscribe links and
-- webhook_secret_encrypted replaced them). The guard stops the deploy before a plaintext signing secret that
-- was never encrypted is lost: rotate or encrypt it first, then redeploy.
-- DEPLOY NOTE: this drops columns the previous release still reads. Deploy with workers scaled to 0 or in a
-- short maintenance window, and do not roll back to the previous image after this migration has run.
DO $$
DECLARE
  plaintext_count integer;
BEGIN
  SELECT count(*) INTO plaintext_count FROM status_page_subscribers WHERE webhook_secret IS NOT NULL AND webhook_secret_encrypted IS NULL;
  IF plaintext_count > 0 THEN
    RAISE EXCEPTION '% status page webhook subscribers still have a plaintext signing secret; run the previous release and rotate their secrets (or re-subscribe them) before applying this migration', plaintext_count;
  END IF;
END
$$;--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
DROP INDEX "status_page_subscribers_unsubscribe_token_idx";--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_subscribers" DROP COLUMN "unsubscribe_token";--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "status_page_subscribers" DROP COLUMN "webhook_secret";--> statement-breakpoint
-- migration-safety: allow-destructive issue=#736
ALTER TABLE "plan_limits" DROP COLUMN "sso_enabled";