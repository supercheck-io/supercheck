/**
 * Shared definitions of run outcomes for the dashboard and analytics views.
 *
 * TestRunStatus = running | queued | passed | failed | error | blocked
 *
 * - FAILED: the run executed and did not succeed (`failed`, `error`). These
 *   count as failures in the Job Status chart and the "failed in 24h" health
 *   check.
 * - NOT PASSED (analytics cards): every terminal outcome that is not `passed`,
 *   i.e. FAILED plus `blocked` (the run could not execute, e.g. plan limits).
 *   Runs still `running` or `queued` are in flight, so they are neither passed
 *   nor not-passed and are excluded from the "Not passed" count.
 */

export const FAILED_RUN_STATUSES = ["failed", "error"] as const;
export const NOT_PASSED_RUN_STATUSES = ["failed", "error", "blocked"] as const;
export const IN_FLIGHT_RUN_STATUSES = ["running", "queued"] as const;

const failed = new Set<string>(FAILED_RUN_STATUSES);
const notPassed = new Set<string>(NOT_PASSED_RUN_STATUSES);
const inFlight = new Set<string>(IN_FLIGHT_RUN_STATUSES);

export const isFailedRunStatus = (status: string | null | undefined): boolean =>
  !!status && failed.has(status);

export const isNotPassedRunStatus = (
  status: string | null | undefined
): boolean => !!status && notPassed.has(status);

export const isInFlightRunStatus = (
  status: string | null | undefined
): boolean => !!status && inFlight.has(status);

export type RunOutcomeSummary = {
  total: number;
  passed: number;
  failed: number;
  notPassed: number;
  inFlight: number;
};

export function summarizeRunOutcomes(
  statuses: Array<string | null | undefined>
): RunOutcomeSummary {
  const summary: RunOutcomeSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    notPassed: 0,
    inFlight: 0,
  };
  for (const status of statuses) {
    summary.total++;
    if (status === "passed") summary.passed++;
    if (isFailedRunStatus(status)) summary.failed++;
    if (isNotPassedRunStatus(status)) summary.notPassed++;
    if (isInFlightRunStatus(status)) summary.inFlight++;
  }
  return summary;
}

/** Subtitle for a "Not passed" metric card. */
export function notPassedCaption(notPassedCount: number): string {
  return notPassedCount > 0 ? "Needs attention" : "All passing";
}

/**
 * Pass rate over finished runs only; in-flight runs are not outcomes yet.
 * Returns a percentage rounded to one decimal.
 */
export function passRatePercent(passed: number, total: number, inFlight: number): number {
  const finished = total - inFlight;
  if (finished <= 0) return 0;
  return Math.round((passed / finished) * 1000) / 10;
}
