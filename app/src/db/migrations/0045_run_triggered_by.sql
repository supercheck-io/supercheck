-- Forward-only. Apply before deploying the app; older app versions ignore the column.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "triggered_by_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Partial: only user-triggered runs are indexed, so ON DELETE SET NULL for a deleted user avoids a full scan.
CREATE INDEX IF NOT EXISTS "runs_triggered_by_user_id_idx" ON "runs" ("triggered_by_user_id") WHERE "triggered_by_user_id" IS NOT NULL;
