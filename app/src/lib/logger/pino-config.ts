/**
 * Pino Logger Configuration for Next.js
 *
 * This module provides a production-ready logging configuration using Pino.
 * Features:
 * - Environment-aware log levels
 * - Structured JSON logging in production
 * - Human-readable console output in development
 * - Request ID tracking
 * - Performance metrics
 * - Error serialization
 */

import pino, { type Logger as PinoLogger } from 'pino';
import pinoPretty from 'pino-pretty';
import { scrubSerializedError } from '@/lib/log-safe-error';

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
 * Create pretty print stream for development
 */
const createPrettyStream = () => {
  return pinoPretty({
    colorize: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
    singleLine: false,
    levelFirst: true,
    messageFormat: '{if module}[{module}]{end} {msg}',
    customColors: 'info:blue,warn:yellow,error:red',
    sync: true, // Use synchronous mode for Next.js compatibility
  });
};

/**
 * Base Pino configuration
 */
export const pinoConfig = {
  level: getLogLevel(),

  // Serialize errors, minus a failed query's parameter values (they can be session tokens or PII).
  serializers: {
    err: (e: Error) => scrubSerializedError(pino.stdSerializers.err(e)),
    error: (e: Error) => scrubSerializedError(pino.stdSerializers.err(e)),
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
 * Create a root logger instance with pretty printing in development
 */
const isDevelopment = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
export const logger: PinoLogger = isDevelopment
  ? pino(pinoConfig, createPrettyStream())
  : pino(pinoConfig);

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
