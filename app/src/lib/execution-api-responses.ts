import { ExecutionWorkloadError } from "./execution/execution-policy";
import { SubscriptionAccessDeniedError } from "./services/subscription-service";
import { NextResponse } from "next/server";
import { VariableResolutionError } from "./variable-resolution-error";
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
  if (error instanceof ExecutionWorkloadError)
    return NextResponse.json(
      { error: error.message, code: "EXECUTION_ENTITLEMENT_DENIED" },
      { status: error.status },
    );
  if (error instanceof VariableResolutionError)
    return NextResponse.json(
      { error: error.message, code: "VARIABLES_UNRESOLVED" },
      { status: 422 },
    );
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
  if (error instanceof VariableResolutionError) return error.message;
  return isExecutionQueueError(error)
    ? getExecutionQueueRunError(error)
    : "Failed to queue execution";
}

/**
 * Maps a failure from getExecutionPolicy to a response. Only an explicit
 * denial is a 402 carrying its message; an operational failure (database,
 * billing provider) is logged and reported generically as a 500.
 */
export function buildExecutionPolicyFailureResponse(
  error: unknown,
): NextResponse {
  if (error instanceof SubscriptionAccessDeniedError) {
    return NextResponse.json(
      { error: error.message, code: error.reason },
      { status: 402 },
    );
  }
  if (error instanceof ExecutionWorkloadError) {
    return NextResponse.json(
      { error: error.message, code: "execution_entitlement_required" },
      { status: error.status },
    );
  }
  console.error("Execution policy lookup failed", error);
  return NextResponse.json(
    { error: "Execution validation unavailable" },
    { status: 500 },
  );
}
