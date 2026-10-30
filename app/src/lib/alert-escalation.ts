/** A delivered failure alert that may open an incident; recoveries, successes and failed deliveries never do. */
export function isActionableAlertForIncident(
  status: string,
  type: string,
  message: string,
) {
  if (status !== "sent") return false;
  const normalizedType = type.toLowerCase();
  return !(
    normalizedType.includes("recovery") ||
    normalizedType.includes("success") ||
    normalizedType.includes("resolved") ||
    message.toLowerCase().includes("completed successfully")
  );
}
