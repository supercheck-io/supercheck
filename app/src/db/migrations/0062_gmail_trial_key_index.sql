-- supercheck:no-transaction
-- Serve the Gmail trial alias lookup in setup-defaults (it runs while holding an advisory lock) without a
-- sequential scan of "user". The expressions match that query exactly; only trial holders are indexed.
-- Built CONCURRENTLY so sign-ups are not blocked; the runner executes this file outside its migration transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_gmail_trial_key_idx" ON "user" USING btree ((replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', ''))) WHERE "user"."trial_granted_at" IS NOT NULL AND split_part(lower("user"."email"), '@', 2) IN ('gmail.com', 'googlemail.com');
