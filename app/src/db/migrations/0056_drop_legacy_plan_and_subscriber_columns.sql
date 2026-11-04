-- Drops the unused plan column plan_limits.sso_enabled and the legacy subscriber columns
-- status_page_subscribers.unsubscribe_token / webhook_secret (signed unsubscribe links and
-- webhook_secret_encrypted replaced them). The guard stops the deploy before a plaintext signing secret that
-- was never encrypted is lost: rotate or encrypt it first, then redeploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM status_page_subscribers WHERE webhook_secret IS NOT NULL AND webhook_secret_encrypted IS NULL) THEN
    RAISE EXCEPTION 'Cannot drop status_page_subscribers.webhook_secret: some rows have a plaintext signing secret and no webhook_secret_encrypted';
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