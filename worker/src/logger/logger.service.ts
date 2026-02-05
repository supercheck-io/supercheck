/**
 * Logger Service for Nest.js Worker
 *
 * Provides a convenient wrapper around Pino logger with:
 * - Automatic context tracking
 * - Type-safe logging methods
 * - Error serialization
 * - Performance tracking
 */

import { Injectable, Scope } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService {
  constructor(private readonly pinoLogger: PinoLogger) {}

  /**
   * Set the logger context (typically the class name)
   */
  setContext(context: string) {
    this.pinoLogger.setContext(context);
  }

  /**
   * Log at trace level (most verbose)
   */
  trace(message: string, data?: Record<string, unknown>) {
    if (data) {
      this.pinoLogger.trace(data, message);
    } else {
      this.pinoLogger.trace(message);
    }
  }

  /**
   * Log at debug level
   */
  debug(message: string, data?: Record<string, unknown>) {
    if (data) {
      this.pinoLogger.debug(data, message);
    } else {
      this.pinoLogger.debug(message);
    }
  }

  /**
   * Log at info level
   */
  info(message: string, data?: Record<string, unknown>) {
    if (data) {
      this.pinoLogger.info(data, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  /**
   * Log at warn level
   */
  warn(message: string, data?: Record<string, unknown>) {
    if (data) {
      this.pinoLogger.warn(data, message);
    } else {
      this.pinoLogger.warn(message);
    }
  }

  /**
   * Log at error level with error object support
   */
  error(message: string, error?: unknown, data?: Record<string, unknown>) {
    const logData: Record<string, unknown> = { ...data };

    if (error instanceof Error) {
      logData.err = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    } else if (error) {
      logData.error = error;
    }

    this.pinoLogger.error(logData, message);
  }

  /**
   * Log at fatal level (most severe)
   */
  fatal(message: string, error?: unknown, data?: Record<string, unknown>) {
    const logData: Record<string, unknown> = { ...data };

    if (error instanceof Error) {
      logData.err = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    } else if (error) {
      logData.error = error;
    }

    this.pinoLogger.fatal(logData, message);
  }

  /**
   * Log operation start with timing
   */
  startOperation(operationName: string, data?: Record<string, unknown>) {
    const startTime = Date.now();
    this.info(`Starting operation: ${operationName}`, {
      ...data,
      operationName,
      startTime,
    });
    return startTime;
  }

  /**
   * Log operation completion with duration
   */
  endOperation(
    operationName: string,
    startTime: number,
    success: boolean = true,
    data?: Record<string, unknown>,
  ) {
    const duration = Date.now() - startTime;
    const logData = {
      ...data,
      operationName,
      duration,
      success,
    };

    if (success) {
      this.info(`Completed operation: ${operationName}`, logData);
    } else {
      this.warn(`Failed operation: ${operationName}`, logData);
    }
  }

  /**
   * Log job/task execution
   */
  logJobExecution(
    jobName: string,
    jobId: string,
    status: 'started' | 'completed' | 'failed',
    data?: Record<string, unknown>,
  ) {
    const logData = {
      ...data,
      jobName,
      jobId,
      status,
    };

    switch (status) {
      case 'started':
        this.info(`Job started: ${jobName}`, logData);
        break;
      case 'completed':
        this.info(`Job completed: ${jobName}`, logData);
        break;
      case 'failed':
        this.error(`Job failed: ${jobName}`, undefined, logData);
        break;
    }
  }

  /**
   * Log database query (for debugging)
   */
  logQuery(query: string, duration?: number, data?: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'development') {
      this.debug('Database query', {
        ...data,
        query,
        duration,
      });
    }
  }

  /**
   * Log external API call
   */
  logApiCall(
    method: string,
    url: string,
    statusCode?: number,
    duration?: number,
    data?: Record<string, unknown>,
  ) {
    const logData = {
      ...data,
      method,
      url,
      statusCode,
      duration,
    };

    if (statusCode && statusCode >= 400) {
      this.warn(`API call failed: ${method} ${url}`, logData);
    } else {
      this.debug(`API call: ${method} ${url}`, logData);
    }
  }
}
