export type ExecutionQueueErrorCode =
  | "capacity_exceeded"
  | "capacity_unavailable"
  | "queue_unavailable";

/**
 * Typed execution admission failure. Internal causes stay server-side while
 * API routes can map the stable code to an accurate, retryable response.
 */
export class ExecutionQueueError extends Error {
  constructor(
    public readonly code: ExecutionQueueErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExecutionQueueError";
  }
}

export function isExecutionQueueError(
  error: unknown,
): error is ExecutionQueueError {
  return error instanceof ExecutionQueueError;
}

export function getExecutionQueueRunError(error: ExecutionQueueError): string {
  switch (error.code) {
    case "capacity_exceeded":
      return "Execution queue capacity reached";
    case "capacity_unavailable":
      return "Execution capacity service temporarily unavailable";
    case "queue_unavailable":
      return "Execution queue temporarily unavailable";
  }
}
