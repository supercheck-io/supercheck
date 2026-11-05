-- Forward-only. Apply before deploying the app; older app versions ignore the column.
ALTER TABLE "notification_policies" ADD COLUMN IF NOT EXISTS "auto_investigate_enabled_at" timestamp with time zone;
