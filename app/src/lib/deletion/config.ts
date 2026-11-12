import { clampInt } from "@/lib/telemetry-retention";

/** Env knobs for the purge worker. Invalid values (NaN, out of range) fall back with a warning instead of disabling a cap. */
const read = (name: string, min: number, max: number, fallback: number) =>
  clampInt(process.env[name], { min, max, fallback, name });

export const MAX_ATTEMPTS = read("DELETION_MAX_ATTEMPTS", 1, 100, 8);
/** Small global cap on concurrent purges across all pods, and one per organization. */
export const GLOBAL_CONCURRENCY = read("DELETION_PURGE_CONCURRENCY", 1, 16, 2);
/** Rows (and S3 prefixes) handled per batch: bounded statements and short row locks. */
export const PURGE_BATCH = read("DELETION_BATCH_SIZE", 100, 1000, 500);
/** Pause between batches so a big purge never saturates the database. */
export const BATCH_PAUSE_MS = read("DELETION_BATCH_PAUSE_MS", 0, 60_000, 100);
/** Progress resets the attempt budget, so a purge that "progresses" forever is stopped by this absolute cap on batches. */
export const MAX_TOTAL_STEPS = read("DELETION_MAX_TOTAL_STEPS", 1, 10_000_000, 100_000);
