import { parseExpression } from 'cron-parser';

/**
 * Calculates the next run date for a given cron expression.
 * @param cronExpression The cron expression string.
 * @param fromDate The date to calculate from (defaults to now).
 * @returns The next run date as a Date object, or null if invalid.
 */
export function getNextRunDate(
  cronExpression: string,
  fromDate: Date = new Date(),
): Date | null {
  try {
    const interval = parseExpression(cronExpression, {
      currentDate: fromDate,
    });
    return interval.next().toDate();
  } catch (err) {
    console.error(`Error parsing cron expression "${cronExpression}":`, err);
    return null;
  }
}
