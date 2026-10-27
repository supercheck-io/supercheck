-- Forward-only. Apply before deploying the app; older app versions ignore the column.
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "triggered_by_user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL;
