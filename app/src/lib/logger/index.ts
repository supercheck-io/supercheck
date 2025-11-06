/**
 * Universal Logger for Next.js
 *
 * Automatically uses the appropriate logger based on environment:
 * - Server-side: Full Pino logger with all features
 * - Client-side: Browser-safe console-based logger
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * logger.info('Simple message');
 * logger.info({ userId: '123' }, 'User action');
 * logger.error({ err: error }, 'Operation failed');
 *
 * // Create child logger with context
 * const childLogger = logger.child({ module: 'auth' });
 * childLogger.info('Authentication successful');
 * ```
 */

import { clientLogger } from './client-logger';
import { logger as serverLogger } from './pino-config';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

/**
 * Universal logger instance
 * Automatically selects server or client logger
 */
export const logger = (isBrowser ? clientLogger : serverLogger) as {
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  fatal: (obj: unknown, msg?: string) => void;
  child: (context: Record<string, unknown>) => unknown;
};

/**
 * Create a child logger with additional context
 *
 * @example
 * const authLogger = createLogger({ module: 'authentication' });
 * authLogger.info('User logged in');
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Re-export HTTP logger for middleware use (server-side only)
 */
export { httpLogger, createHttpLoggerMiddleware } from './http-logger';

/**
 * Re-export server logger for explicit server-side use
 */
export { logger as serverLogger, createLogger as createServerLogger } from './pino-config';

/**
 * Re-export client logger for explicit client-side use
 */
export { clientLogger, createClientLogger } from './client-logger';

export default logger;
