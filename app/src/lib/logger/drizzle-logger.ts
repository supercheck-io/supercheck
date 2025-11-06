/**
 * Drizzle ORM Logger for Pino
 *
 * Integrates Drizzle's query logging with Pino for structured logging
 */

import { Logger } from 'drizzle-orm';
import { createLogger } from './index';

const dbLogger = createLogger({ module: 'database' }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * Custom Drizzle logger that uses Pino
 */
export class DrizzlePinoLogger implements Logger {
  logQuery(query: string, params: unknown[]): void {
    // Only log queries in development and if LOG_DB_QUERIES is enabled
    if (
      process.env.NODE_ENV === 'development' &&
      process.env.LOG_DB_QUERIES === 'true'
    ) {
      dbLogger.debug(
        {
          query: query.length > 500 ? query.substring(0, 500) + '...' : query,
          params,
        },
        'Database query'
      );
    }
  }
}

/**
 * Export singleton instance
 */
export const drizzleLogger = new DrizzlePinoLogger();

export default drizzleLogger;
