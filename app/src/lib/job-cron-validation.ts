import { CronExpressionParser } from "cron-parser";

/**
 * Error message for a job cron that is not exactly five fields or does not parse, else null. An empty value
 * means "no schedule" and is allowed. Five fields guarantee a one-minute minimum gap: cron-parser also accepts
 * a leading seconds field, which would fire a job every second. The plan catalogue has no trial minimum for
 * jobs (only monitors), so none is enforced here.
 */
export function validateJobCron(cron: string | null | undefined): string | null {
  const expression = cron?.trim();
  if (!expression) return null;
  if (expression.split(/\s+/).length !== 5) {
    return "cronSchedule must be a standard 5-field cron expression (minute is the finest interval)";
  }
  try {
    CronExpressionParser.parse(expression);
  } catch {
    return "cronSchedule is not a valid cron expression";
  }
  return null;
}
