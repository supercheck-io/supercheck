/**
 * Drizzle ORM Logger for Pino
 *
 * Integrates Drizzle's query logging with Pino for structured logging
 * This custom logger completely replaces Drizzle's default console output
 */

import { Logger } from 'drizzle-orm';
import { logger as pinoLogger } from './pino-config';

/**
 * Custom Drizzle logger that uses Pino
 * By implementing this, we suppress Drizzle's default console.log output
 */
export class DrizzlePinoLogger implements Logger {
  private logger: ReturnType<typeof pinoLogger.child>;

  constructor() {
    // Create a child logger for database queries
    this.logger = pinoLogger.child({ module: 'database' });
  }

  logQuery(query: string, params: unknown[]): void {
    // Only log queries in development and if LOG_DB_QUERIES is enabled
    // Even if we don't log, this method suppresses Drizzle's default output
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.LOG_DB_QUERIES === 'true'
    ) {
      this.logger.debug(
        {
          query: query.length > 500 ? query.substring(0, 500) + '...' : query,
          params,
        },
        'Database query'
      );
    }
    // If conditions not met, do nothing - this still suppresses default logging
  }
}

/**
 * Export singleton instance
 */
export const drizzleLogger = new DrizzlePinoLogger();

export default drizzleLogger;
