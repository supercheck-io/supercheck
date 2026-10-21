-- Better Auth 1.7 reads and writes invitation.created_at.
-- Additive with a default, so code from before this release keeps inserting invitations unchanged.
-- Existing rows are backfilled with the migration time.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
