import { isFailedRunStatus } from "./run-outcomes";

export type RecentRunLike = {
  id: string;
  jobId: string;
  jobName: string;
  status: string;
  startedAt: string;
  trigger: string;
};

/** Newest failed/error runs first, capped at `limit`. */
export function selectRecentFailures<T extends RecentRunLike>(
  runs: T[],
  limit = 5
): T[] {
  return runs
    .filter((run) => isFailedRunStatus(run.status) && !!run.startedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
}

export type IncidentLike = { status: string };

/** Open = anything not yet resolved. */
export const isOpenIncident = (incident: IncidentLike): boolean =>
  incident.status !== "resolved";
