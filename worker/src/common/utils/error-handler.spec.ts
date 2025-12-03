import { Logger } from '@nestjs/common';
import { ErrorHandler } from './error-handler';

// Mock the Logger
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Logger: jest.fn().mockImplementation(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('ErrorHandler', () => {
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = new Logger() as jest.Mocked<Logger>;
    jest.clearAllMocks();
  });

  describe('extractMessage', () => {
    // Tests safe error message extraction from unknown error types

    it('should extract message from Error object', () => {
      // Standard Error objects should have their message extracted
      const error = new Error('Test error message');
      expect(ErrorHandler.extractMessage(error)).toBe('Test error message');
    });

    it('should extract message from custom Error subclasses', () => {
      // Custom error classes should work the same
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error message');
      expect(ErrorHandler.extractMessage(error)).toBe('Custom error message');
    });

    it('should convert string errors to string', () => {
      // String errors should pass through
      expect(ErrorHandler.extractMessage('String error')).toBe('String error');
    });

    it('should return default message for unknown error types', () => {
      // Non-Error objects should get default message
      expect(ErrorHandler.extractMessage({})).toBe('Unknown error occurred');
      expect(ErrorHandler.extractMessage(null)).toBe('Unknown error occurred');
      expect(ErrorHandler.extractMessage(undefined)).toBe(
        'Unknown error occurred',
      );
    });

    it('should handle number errors', () => {
      // Numbers are not valid errors
      expect(ErrorHandler.extractMessage(404)).toBe('Unknown error occurred');
    });

    it('should handle Error objects with empty message', () => {
      const error = new Error('');
      // Empty message is still a valid message
      expect(ErrorHandler.extractMessage(error)).toBe('');
    });
  });

  describe('extractStack', () => {
    // Tests stack trace extraction for debugging

    it('should extract stack from Error object', () => {
      // Stack traces are essential for debugging
      const error = new Error('Test error');
      const stack = ErrorHandler.extractStack(error);
      expect(stack).toBeDefined();
      expect(stack).toContain('Error: Test error');
    });

    it('should return undefined for non-Error objects', () => {
      // Non-Error objects don't have stacks
      expect(ErrorHandler.extractStack('string error')).toBeUndefined();
      expect(ErrorHandler.extractStack({})).toBeUndefined();
      expect(ErrorHandler.extractStack(null)).toBeUndefined();
    });

    it('should extract stack from custom Error subclasses', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error');
      const stack = ErrorHandler.extractStack(error);
      expect(stack).toBeDefined();
      expect(stack).toContain('CustomError');
    });
  });

  describe('isTimeoutError', () => {
    // Tests timeout error detection for appropriate handling

    it('should detect "timeout" in error message', () => {
      const error = new Error('Connection timeout');
      expect(ErrorHandler.isTimeoutError(error)).toBe(true);
    });

    it('should detect "timed out" in error message', () => {
      const error = new Error('Request timed out');
      expect(ErrorHandler.isTimeoutError(error)).toBe(true);
    });

    it('should detect "execution timeout" in error message', () => {
      const error = new Error('Test execution timeout exceeded');
      expect(ErrorHandler.isTimeoutError(error)).toBe(true);
    });

    it('should be case-insensitive', () => {
      // Timeout detection should work regardless of case
      expect(ErrorHandler.isTimeoutError(new Error('TIMEOUT'))).toBe(true);
      expect(ErrorHandler.isTimeoutError(new Error('TimeOut'))).toBe(true);
    });

    it('should return false for non-timeout errors', () => {
      expect(ErrorHandler.isTimeoutError(new Error('Connection refused'))).toBe(
        false,
      );
      expect(ErrorHandler.isTimeoutError(new Error('Permission denied'))).toBe(
        false,
      );
    });

    it('should handle string errors', () => {
      expect(ErrorHandler.isTimeoutError('Request timeout')).toBe(true);
      expect(ErrorHandler.isTimeoutError('Connection error')).toBe(false);
    });
  });

  describe('isPermissionError', () => {
    // Tests permission error detection for security-related handling

    it('should detect "permission denied" in error message', () => {
      const error = new Error('Permission denied: /etc/passwd');
      expect(ErrorHandler.isPermissionError(error)).toBe(true);
    });

    it('should detect "eacces" in error message', () => {
      // EACCES is the Unix permission error code
      const error = new Error('EACCES: permission denied');
      expect(ErrorHandler.isPermissionError(error)).toBe(true);
    });

    it('should detect "eperm" in error message', () => {
      // EPERM is the Unix operation not permitted error
      const error = new Error('EPERM: operation not permitted');
      expect(ErrorHandler.isPermissionError(error)).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(
        ErrorHandler.isPermissionError(new Error('PERMISSION DENIED')),
      ).toBe(true);
      expect(ErrorHandler.isPermissionError(new Error('Eacces'))).toBe(true);
    });

    it('should return false for non-permission errors', () => {
      expect(ErrorHandler.isPermissionError(new Error('File not found'))).toBe(
        false,
      );
      expect(
        ErrorHandler.isPermissionError(new Error('Connection timeout')),
      ).toBe(false);
    });
  });

  describe('logError', () => {
    // Tests error logging with proper context

    it('should log error with context', () => {
      const error = new Error('Test error');
      ErrorHandler.logError(mockLogger, error, 'TestContext');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should include additional info in log', () => {
      const error = new Error('Test error');
      const additionalInfo = { userId: '123', action: 'test' };
      ErrorHandler.logError(mockLogger, error, 'TestContext', additionalInfo);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle non-Error objects', () => {
      ErrorHandler.logError(mockLogger, 'String error', 'TestContext');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleDatabaseError', () => {
    // Tests database operation error handling with fallback

    it('should return result on successful operation', async () => {
      const operation = jest.fn().mockResolvedValue({ id: 1, name: 'test' });
      const result = await ErrorHandler.handleDatabaseError(
        mockLogger,
        operation,
        'test query',
      );
      expect(result).toEqual({ id: 1, name: 'test' });
    });

    it('should log error and return fallback on failure', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('DB error'));
      const fallback = { id: 0, name: 'default' };
      const result = await ErrorHandler.handleDatabaseError(
        mockLogger,
        operation,
        'test query',
        fallback,
      );
      expect(result).toEqual(fallback);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return undefined if no fallback provided on error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('DB error'));
      const result = await ErrorHandler.handleDatabaseError(
        mockLogger,
        operation,
        'test query',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('safeExecute', () => {
    // Tests generic safe execution wrapper

    it('should return result on successful execution', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await ErrorHandler.safeExecute(
        mockLogger,
        operation,
        'test operation',
      );
      expect(result).toBe('success');
    });

    it('should log error and return undefined on failure without handler', async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new Error('Operation failed'));
      const result = await ErrorHandler.safeExecute(
        mockLogger,
        operation,
        'test operation',
      );
      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should call onError handler and return its result on failure', async () => {
      const operation = jest
        .fn()
        .mockRejectedValue(new Error('Operation failed'));
      const onError = jest.fn().mockReturnValue('fallback');
      const result = await ErrorHandler.safeExecute(
        mockLogger,
        operation,
        'test operation',
        onError,
      );
      expect(result).toBe('fallback');
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should pass the error to onError handler', async () => {
      const testError = new Error('Specific error');
      const operation = jest.fn().mockRejectedValue(testError);
      const onError = jest.fn();
      await ErrorHandler.safeExecute(mockLogger, operation, 'test', onError);
      expect(onError).toHaveBeenCalledWith(testError);
    });

    it('should handle async operations', async () => {
      const operation = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'delayed result';
      });
      const result = await ErrorHandler.safeExecute(
        mockLogger,
        operation,
        'async operation',
      );
      expect(result).toBe('delayed result');
    });
  });
});
