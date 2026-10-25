-- Apply before deploying the app. Keep this column on rollback to preserve consumed grants.
ALTER TABLE "user" ADD COLUMN "trial_granted_at" timestamptz;
