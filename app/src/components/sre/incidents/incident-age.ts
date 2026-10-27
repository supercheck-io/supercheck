/** Compact age such as 5m, 3h, 2d. */
export function formatAge(from: Date | string, to: Date | string | number = Date.now()) {
  const minutes = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
