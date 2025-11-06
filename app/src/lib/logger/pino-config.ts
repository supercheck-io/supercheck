/**
 * Pino Logger Configuration for Next.js
 *
 * This module provides a production-ready logging configuration using Pino.
 * Features:
 * - Environment-aware log levels
 * - Structured JSON logging in production
 * - Simple console output in development (no worker threads)
 * - Request ID tracking
 * - Performance metrics
 * - Error serialization
 */

import pino, { type Logger as PinoLogger } from 'pino';

/**
 * Determine log level based on environment
 */
const getLogLevel = (): string => {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  switch (process.env.NODE_ENV) {
    case 'production':
      return 'info';
    case 'test':
      return 'silent';
    default:
      return 'debug';
  }
};

/**
 * Base Pino configuration
 * No worker threads - compatible with Next.js and Turbopack
 */
export const pinoConfig = {
  level: getLogLevel(),

  // Browser-compatible check
  browser: {
    asObject: true,
  },

  // Serialize errors properly
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Base context for all logs
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'supercheck-app',
  },

  // Format timestamp
  timestamp: pino.stdTimeFunctions.isoTime,

  // Format log levels
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
};

/**
 * Create a root logger instance
 * Using stdout directly (no worker threads for Next.js compatibility)
 */
export const logger: PinoLogger = pino(pinoConfig);

/**
 * Create a child logger with additional context
 *
 * @example
 * const logger = createLogger({ module: 'auth', userId: '123' });
 * logger.info('User logged in');
 */
export function createLogger(context: Record<string, unknown>): PinoLogger {
  return logger.child(context);
}

/**
 * Type-safe logger interface for application use
 */
export type Logger = PinoLogger;

export default logger;
