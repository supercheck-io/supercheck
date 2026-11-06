/**
 * The API stores the report's storage location (an internal host such as http://rustfs:9000/...).
 * Show the address that works from outside: the application's own report route.
 * The run status route names the id `runId`.
 */
export function publicReportUrl(client: { getBaseUrl(): string }, input: Record<string, unknown>): Record<string, unknown> {
  // A run of a single test has no job, so the API reports testCount 0; showing "Test Count: 0" is misleading.
  let run = input
  if (run.testCount === 0 && !run.jobId) { run = { ...run }; delete run.testCount }
  const id = run.id ?? run.runId
  if (typeof run.reportUrl !== 'string' || !run.reportUrl || typeof id !== 'string') return run
  return { ...run, reportUrl: `${client.getBaseUrl().replace(/\/$/, '')}/api/test-results/${encodeURIComponent(id)}/report/index.html` }
}
