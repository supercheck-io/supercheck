import { Logger } from '@nestjs/common';
import { ExecutionError } from '../errors/execution-error';

/**
 * Utility class for standardized error handling
 */
export class ErrorHandler {
  /**
   * Safely extracts error message from unknown error types
   */
  static extractMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error occurred';
  }

  /**
   * Safely extracts error stack from unknown error types
   */
  static extractStack(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.stack;
    }
    return undefined;
  }

  /**
   * Checks if error indicates a timeout condition
   */
  static isTimeoutError(error: unknown): boolean {
    const message = this.extractMessage(error).toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('execution timeout')
    );
  }

  /**
   * Checks if error indicates a permission issue
   */
  static isPermissionError(error: unknown): boolean {
    const message = this.extractMessage(error).toLowerCase();
    return (
      message.includes('permission denied') ||
      message.includes('eacces') ||
      message.includes('eperm')
    );
  }

  /**
   * Logs error with appropriate level and context
   */
  static logError(
    logger: Logger,
    error: unknown,
    context: string,
    additionalInfo?: Record<string, unknown>,
  ): void {
    const message = this.extractMessage(error);
    const stack = this.extractStack(error);

    if (error instanceof ExecutionError) {
      logger.error(`[${context}] ${error.code}: ${message}`, {
        ...error.context,
        ...additionalInfo,
      });
    } else {
      logger.error(`[${context}] ${message}`, stack, { ...additionalInfo });
    }
  }

  /**
   * Handles database operation errors with proper logging
   */
  static async handleDatabaseError<T>(
    logger: Logger,
    operation: () => Promise<T>,
    context: string,
    fallbackValue?: T,
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.logError(logger, error, `Database operation failed: ${context}`);
      return fallbackValue;
    }
  }

  /**
   * Wraps async operations with error handling
   */
  static async safeExecute<T>(
    logger: Logger,
    operation: () => Promise<T>,
    context: string,
    onError?: (error: unknown) => T,
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.logError(logger, error, context);
      return onError?.(error);
    }
  }
}
