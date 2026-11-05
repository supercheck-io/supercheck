/**
 * The reports table stores the storage location (an internal host or a bucket URL).
 * API callers get the authenticated application route that serves the report instead.
 */
export function runReportPath(
  runId: string,
  storedUrl: string | null | undefined,
): string | null {
  return storedUrl ? `/api/test-results/${encodeURIComponent(runId)}/report/index.html` : null;
}
