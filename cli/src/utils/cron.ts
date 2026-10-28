/** Warning for a job cron the server rejects on update (it requires exactly five fields), else null. Empty means no schedule. */
export function jobCronWarning(name: string, cron: string | null | undefined): string | null {
  const expression = cron?.trim()
  if (!expression || expression.split(/\s+/).length === 5) return null
  return `Job "${name}": cronSchedule "${expression}" is not a 5-field cron expression; the server rejects it on update. Rewrite it with five fields before deploying.`
}
