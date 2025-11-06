/**
 * Pino Logger Configuration for Next.js
 *
 * This module provides a production-ready logging configuration using Pino.
 * Features:
 * - Environment-aware log levels
 * - Structured JSON logging in production
 * - Pretty printing in development
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
 * Create transport configuration
 * In production: JSON output
 * In development: Pretty printed colorized output
 */
const getTransport = () => {
  if (process.env.NODE_ENV === 'production') {
    // Production: structured JSON logs
    return undefined;
  }

  // Development: pretty printed logs
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false,
      messageFormat: '{levelLabel} - {if req.method}[{req.method} {req.url}]{end} {msg}',
    },
  };
};

/**
 * Base Pino configuration
 */
export const pinoConfig = {
  level: getLogLevel(),

  // Format timestamp
  timestamp: () => `,"time":"${new Date().toISOString()}"`,

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

  // Format log levels
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },

  // Transport configuration
  transport: getTransport(),
};

/**
 * Create a root logger instance
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
