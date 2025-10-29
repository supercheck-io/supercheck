import { CronExpressionParser } from 'cron-parser';

/**
 * Calculates the next run date for a given cron expression
 * @param cronExpression The cron expression to calculate next run date from
 * @returns A Date object representing the next run date or null if invalid
 */
export function getNextRunDate(cronExpression: string | null | undefined): Date | null {
  if (!cronExpression) return null;
  
  try {
    // Parse the cron expression
    const expression = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz: 'UTC' // Assuming UTC timezone for consistency
    });
    
    // Get the next date
    return expression.next().toDate();
  } catch (error) {
    console.error(`Error parsing cron expression: ${cronExpression}`, error);
    return null;
  }
}

/**
 * Formats the next run date in a human-readable format
 * @param date The date to format
 * @returns A formatted string or "No date" if date is null
 */
export function formatNextRunDate(date: Date | null): string {
  if (!date) return "No date";
  
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  
} 