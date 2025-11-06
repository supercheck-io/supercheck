/**
 * Database Query Logger
 *
 * Provides database query logging using Pino.
 * Only logs in development mode to avoid performance impact.
 */

import { createLogger } from './index';

const dbLogger = createLogger({ module: 'database' }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

/**
 * Log database queries (only in development)
 */
export function logQuery(query: string, params?: unknown[], duration?: number) {
  if (process.env.NODE_ENV === 'development' && process.env.LOG_DB_QUERIES === 'true') {
    dbLogger.debug(
      {
        query: query.substring(0, 200), // Limit query length
        params,
        duration,
      },
      'Database query'
    );
  }
}

/**
 * Log database errors
 */
export function logQueryError(query: string, error: Error, params?: unknown[]) {
  dbLogger.error(
    {
      err: error,
      query: query.substring(0, 200),
      params,
    },
    'Database query failed'
  );
}

export default dbLogger;
