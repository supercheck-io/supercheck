-- monitors.muted_until was never used (there is no mute feature) and left the Drizzle schemas in 0068.
-- Workers of the previous release still select it, so their checks can fail until they are replaced.
-- migration-safety: allow-destructive issue=#852
ALTER TABLE "monitors" DROP COLUMN IF EXISTS "muted_until";
