/** Failed runs the dashboard lists; the server returns the newest ones, already capped. */
export const RECENT_FAILURES_LIMIT = 5;

export type IncidentLike = { status: string };

/** Open = anything not yet resolved. */
export const isOpenIncident = (incident: IncidentLike): boolean =>
  incident.status !== "resolved";
