-- Forward-only. Apply before deploying the app; older app versions ignore the new columns.
-- Status page subscriber secrets: verification tokens are stored as SHA-256 hashes, webhook signing
-- secrets get an encrypted column, and the legacy unsubscribe token column gets an index so the public
-- lookup is not a full scan. New unsubscribe links are signed by the app and need no stored token.
--
-- Webhook secrets cannot be backfilled here: encryption needs SECRET_ENCRYPTION_KEY, which only the app
-- has. The app encrypts a legacy plaintext "webhook_secret" the first time it signs with it and then
-- clears the plaintext. The legacy "unsubscribe_token" column keeps working for links already emailed
-- and can be cleared in a later release.
ALTER TABLE "status_page_subscribers" ADD COLUMN IF NOT EXISTS "verification_token_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "status_page_subscribers" ADD COLUMN IF NOT EXISTS "webhook_secret_encrypted" text;
--> statement-breakpoint
-- Hash existing verification tokens, then drop the plaintext for the rows that now have a hash.
UPDATE "status_page_subscribers"
SET "verification_token_hash" = encode(sha256(convert_to("verification_token", 'UTF8')), 'hex')
WHERE "verification_token" IS NOT NULL AND "verification_token_hash" IS NULL;
--> statement-breakpoint
UPDATE "status_page_subscribers"
SET "verification_token" = NULL
WHERE "verification_token" IS NOT NULL AND "verification_token_hash" IS NOT NULL;
--> statement-breakpoint
-- Tokens are random 256-bit values, so hashes do not collide in practice; the index is unique.
CREATE UNIQUE INDEX "status_page_subscribers_verification_token_hash_idx" ON "status_page_subscribers" USING btree ("verification_token_hash") WHERE "verification_token_hash" IS NOT NULL;
--> statement-breakpoint
-- Fallback lookup for rows written by an app version that still stores the plaintext token.
CREATE INDEX "status_page_subscribers_verification_token_idx" ON "status_page_subscribers" USING btree ("verification_token") WHERE "verification_token" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "status_page_subscribers_unsubscribe_token_idx" ON "status_page_subscribers" USING btree ("unsubscribe_token") WHERE "unsubscribe_token" IS NOT NULL;
