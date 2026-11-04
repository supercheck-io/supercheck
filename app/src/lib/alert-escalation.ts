const FAILURE_TYPES = new Set(["monitor_failure", "job_failed", "job_timeout", "ssl_expiring"]);

/** An alert that was attempted (sent or failed delivery) may open an incident; only undelivered (pending) rows wait. */
export const isAttemptedAlertStatus = (status: string) => status === "sent" || status === "failed";

/** A failure alert that may open an incident, manually or in the background; recoveries and successes never do. */
export function isActionableAlertForIncident(
  status: string,
  type: string,
  message: string,
) {
  if (!isAttemptedAlertStatus(status)) return false;
  const normalizedType = type.toLowerCase();
  // Known failure types are classified by type alone; a failure message may quote an earlier successful run.
  if (FAILURE_TYPES.has(normalizedType)) return true;
  return !(
    normalizedType.includes("recovery") ||
    normalizedType.includes("success") ||
    normalizedType.includes("resolved") ||
    message.toLowerCase().includes("completed successfully")
  );
}
