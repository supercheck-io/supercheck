/**
 * Cancellation Service for App
 *
 * Manages cancellation signals for test/job executions using Redis.
 * The cancel API sets a signal, and workers check for it during execution.
 */

import { getRedisConnection } from "./queue";

const CANCELLATION_KEY_PREFIX = "supercheck:cancel:";
const CANCELLATION_TTL = 3600; // 1 hour TTL for cancellation flags

/**
 * Set a cancellation signal for a run
 * Workers will check this signal and stop execution
 *
 * @param runId - The run ID to cancel
 */
export async function setCancellationSignal(runId: string): Promise<void> {
  try {
    const redis = await getRedisConnection();
    const key = `${CANCELLATION_KEY_PREFIX}${runId}`;
    await redis.setex(key, CANCELLATION_TTL, "1");
    console.log(`[CancellationService] Signal set for run ${runId}`);
  } catch (error) {
    console.error(
      `[CancellationService] Failed to set signal for ${runId}:`,
      error
    );
    throw error;
  }
}

/**
 * Check if a run has been cancelled
 *
 * @param runId - The run ID to check
 * @returns true if cancelled, false otherwise
 */
export async function isCancelled(runId: string): Promise<boolean> {
  try {
    const redis = await getRedisConnection();
    const key = `${CANCELLATION_KEY_PREFIX}${runId}`;
    const result = await redis.get(key);
    return result === "1";
  } catch (error) {
    console.error(
      `[CancellationService] Failed to check cancellation for ${runId}:`,
      error
    );
    return false;
  }
}

/**
 * Clear the cancellation signal for a run
 *
 * @param runId - The run ID to clear
 */
export async function clearCancellationSignal(runId: string): Promise<void> {
  try {
    const redis = await getRedisConnection();
    const key = `${CANCELLATION_KEY_PREFIX}${runId}`;
    await redis.del(key);
    console.log(`[CancellationService] Signal cleared for run ${runId}`);
  } catch (error) {
    console.error(
      `[CancellationService] Failed to clear signal for ${runId}:`,
      error
    );
  }
}
