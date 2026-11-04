/**
 * Utility functions for job and run status management
 * Centralized to ensure consistent status calculation across the application
 */

import type { TestRunStatus } from "@/db/schema";

export type RunStatus = TestRunStatus;

/**
 * Determine if a run can be cancelled based on its current status
 *
 * @param status - Current run status
 * @returns True if run can be cancelled
 */
export function canCancelRun(status: RunStatus): boolean {
  return ["running", "queued", "pending"].includes(status);
}
