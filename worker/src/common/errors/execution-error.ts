/**
 * Custom error classes for execution service
 */

export abstract class ExecutionError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TestExecutionError extends ExecutionError {
  readonly code = 'TEST_EXECUTION_ERROR';
  readonly statusCode = 500;

  constructor(
    message: string,
    public readonly testId: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, testId });
  }
}

export class JobExecutionError extends ExecutionError {
  readonly code = 'JOB_EXECUTION_ERROR';
  readonly statusCode = 500;

  constructor(
    message: string,
    public readonly jobId: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, jobId });
  }
}

export class PlaywrightTimeoutError extends ExecutionError {
  readonly code = 'PLAYWRIGHT_TIMEOUT';
  readonly statusCode = 408;

  constructor(
    message: string,
    public readonly timeoutMs: number,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, timeoutMs });
  }
}

export class PermissionError extends ExecutionError {
  readonly code = 'PERMISSION_ERROR';
  readonly statusCode = 403;

  constructor(
    message: string,
    public readonly path: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, path });
  }
}

export class MonitorExecutionError extends ExecutionError {
  readonly code = 'MONITOR_EXECUTION_ERROR';
  readonly statusCode = 500;

  constructor(
    message: string,
    public readonly monitorId: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { ...context, monitorId });
  }
}
