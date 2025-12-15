-- Remove legacy duration varchar field (only durationMs integer is used now)
ALTER TABLE "runs" DROP COLUMN IF EXISTS "duration";
