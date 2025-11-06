/**
 * Client-side Logger for Next.js
 *
 * A browser-safe logger that mimics Pino's interface but uses console methods.
 * This prevents server-side code from running in the browser.
 */

export interface ClientLogger {
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  fatal: (obj: unknown, msg?: string) => void;
  child: (context: Record<string, unknown>) => ClientLogger;
}

class BrowserLogger implements ClientLogger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  private formatLog(level: string, obj: unknown, msg?: string): void {
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(this.context).length > 0
      ? ` ${JSON.stringify(this.context)}`
      : '';

    // Map log level to console method
    const consoleMethod = level === 'debug' ? console.log : console[level as 'log' | 'info' | 'warn' | 'error'];

    if (typeof obj === 'string') {
      consoleMethod(`[${timestamp}]${contextStr} ${obj}`);
    } else if (msg) {
      consoleMethod(`[${timestamp}]${contextStr} ${msg}`, obj);
    } else {
      consoleMethod(`[${timestamp}]${contextStr}`, obj);
    }
  }

  trace(obj: unknown, msg?: string): void {
    if (process.env.NODE_ENV === 'development') {
      this.formatLog('debug', obj, msg);
    }
  }

  debug(obj: unknown, msg?: string): void {
    if (process.env.NODE_ENV === 'development') {
      this.formatLog('debug', obj, msg);
    }
  }

  info(obj: unknown, msg?: string): void {
    this.formatLog('info', obj, msg);
  }

  warn(obj: unknown, msg?: string): void {
    this.formatLog('warn', obj, msg);
  }

  error(obj: unknown, msg?: string): void {
    this.formatLog('error', obj, msg);
  }

  fatal(obj: unknown, msg?: string): void {
    this.formatLog('error', obj, msg);
  }

  child(context: Record<string, unknown>): ClientLogger {
    return new BrowserLogger({ ...this.context, ...context });
  }
}

/**
 * Create a client-safe logger instance
 */
export const clientLogger: ClientLogger = new BrowserLogger({
  service: 'supercheck-app',
  env: process.env.NODE_ENV || 'development',
});

/**
 * Create a child logger with additional context
 */
export function createClientLogger(context: Record<string, unknown>): ClientLogger {
  return clientLogger.child(context);
}

export default clientLogger;
