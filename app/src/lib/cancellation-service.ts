/**
 * Cancellation Service for App
 *
 * Manages cancellation signals for test/job executions using Redis.
 * The cancel API sets a signal, and workers check for it during execution.
 */

import { getRedisConnection } from "./queue";

/**
 * errorDetails value that marks a run as cancelled by a user. The cancel route writes it, and the
 * worker's admission, recovery and finalization all compare against it. Keep it identical to
 * worker/src/common/services/cancellation.service.ts (asserted by cancellation-marker.spec.ts).
 */
export const RUN_CANCELLATION_MARKER = "Cancellation requested by user";

const CANCELLATION_KEY_PREFIX = "supercheck:cancel:";
const CANCELLATION_TTL = 7200; // Keep the signal beyond the 80-minute recovery window.

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
