/**
 * Logger Class - Pino-backed implementation
 *
 * This maintains the existing Logger interface for backward compatibility
 * while using Pino under the hood for robust logging.
 */

import { createLogger as createPinoLogger } from './logger/index';
import { createClientLogger } from './logger/client-logger';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

export class Logger {
  private prefix: string;
   
  private pinoLogger: any;

  constructor(prefix: string = "[App]") {
    this.prefix = prefix;

    // Create a child logger with the prefix as context
    if (!isBrowser) {
      // Server-side: use full Pino features
      this.pinoLogger = createPinoLogger({
        component: this.prefix.replace(/[\[\]]/g, ''),
      });
    } else {
      // Client-side: use browser-safe logger
      this.pinoLogger = createClientLogger({
        component: this.prefix.replace(/[\[\]]/g, ''),
      });
    }
  }

  log(message: string, ...optionalParams: unknown[]): void {
    if (optionalParams.length > 0) {
      this.pinoLogger.info({ data: optionalParams }, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  info(message: string, ...optionalParams: unknown[]): void {
    if (optionalParams.length > 0) {
      this.pinoLogger.info({ data: optionalParams }, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    if (optionalParams.length > 0) {
      this.pinoLogger.warn({ data: optionalParams }, message);
    } else {
      this.pinoLogger.warn(message);
    }
  }

  error(message: string, ...optionalParams: unknown[]): void {
    if (optionalParams.length > 0) {
      // Check if first param is an Error object
      const firstParam = optionalParams[0];
      if (firstParam instanceof Error) {
        this.pinoLogger.error({ err: firstParam, data: optionalParams.slice(1) }, message);
      } else {
        this.pinoLogger.error({ data: optionalParams }, message);
      }
    } else {
      this.pinoLogger.error(message);
    }
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    if (optionalParams.length > 0) {
      this.pinoLogger.debug({ data: optionalParams }, message);
    } else {
      this.pinoLogger.debug(message);
    }
  }
}

// Global default logger instance (optional)
export const defaultLogger = new Logger();
