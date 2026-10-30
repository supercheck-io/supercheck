const FAILURE_TYPES = new Set(["monitor_failure", "job_failed", "job_timeout", "ssl_expiring"]);

/** A delivered failure alert that may open an incident; recoveries, successes and failed deliveries never do. */
export function isActionableAlertForIncident(
  status: string,
  type: string,
  message: string,
) {
  if (status !== "sent") return false;
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
