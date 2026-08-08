import { NextResponse } from "next/server";
import type { ExecutionRateLimitResult } from "./execution-rate-limiter";
import {
  getExecutionQueueRunError,
  isExecutionQueueError,
} from "./execution-errors";

const RETRY_AFTER_SECONDS = 5;

export function buildExecutionRateLimitResponse(
  result: ExecutionRateLimitResult,
): NextResponse | null {
  if (result.allowed) return null;

  const unavailable = result.reason === "unavailable";
  return NextResponse.json(
    unavailable
      ? {
          error:
            "Execution admission is temporarily unavailable. Please try again shortly.",
          code: "EXECUTION_ADMISSION_UNAVAILABLE",
        }
      : {
          error: "Execution rate limit reached. Please try again shortly.",
          code: "EXECUTION_RATE_LIMITED",
        },
    {
      status: unavailable ? 503 : 429,
      headers: { "Retry-After": String(result.retryAfter) },
    },
  );
}

export function buildExecutionQueueErrorResponse(
  error: unknown,
): NextResponse | null {
  if (!isExecutionQueueError(error)) return null;

  const capacityExceeded = error.code === "capacity_exceeded";
  const capacityUnavailable = error.code === "capacity_unavailable";
  return NextResponse.json(
    capacityExceeded
      ? {
          error: "Queue capacity limit reached. Please try again later.",
          code: "EXECUTION_CAPACITY_REACHED",
        }
      : capacityUnavailable
        ? {
            error:
              "Execution admission is temporarily unavailable. Please try again shortly.",
            code: "EXECUTION_ADMISSION_UNAVAILABLE",
          }
        : {
            error:
              "Execution queue is temporarily unavailable. Please try again shortly.",
            code: "EXECUTION_QUEUE_UNAVAILABLE",
          },
    {
      status: capacityExceeded ? 429 : 503,
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
    },
  );
}

export function getSafeExecutionQueueErrorDetails(error: unknown): string {
  return isExecutionQueueError(error)
    ? getExecutionQueueRunError(error)
    : "Failed to queue execution";
}
