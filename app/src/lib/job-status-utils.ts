/**
 * Utility functions for job and run status management
 * Centralized to ensure consistent status calculation across the application
 */

export type RunStatus = "pending" | "running" | "passed" | "failed" | "error";
export type JobStatus = "pending" | "running" | "passed" | "failed" | "error";

/**
 * Calculate job status based on the statuses of all its runs
 *
 * Priority order:
 * 1. error - if any run has error
 * 2. failed - if any run has failed
 * 3. running - if any run is running or pending
 * 4. passed - if all runs passed
 * 5. error - default fallback
 *
 * @param runStatuses - Array of run status strings
 * @returns Calculated job status
 */
export function calculateJobStatus(runStatuses: RunStatus[]): JobStatus {
  if (runStatuses.length === 0) {
    return "pending";
  }

  if (runStatuses.some((s) => s === "error")) {
    return "error";
  }

  if (runStatuses.some((s) => s === "failed")) {
    return "failed";
  }

  if (runStatuses.some((s) => s === "running" || s === "pending")) {
    return "running";
  }

  if (runStatuses.every((s) => s === "passed")) {
    return "passed";
  }

  // Fallback to error if status is unknown
  return "error";
}

/**
 * Determine if a run can be cancelled based on its current status
 *
 * @param status - Current run status
 * @returns True if run can be cancelled
 */
export function canCancelRun(status: RunStatus): boolean {
  return ["running", "pending"].includes(status);
}
