import { ExecutionQueueError } from "./execution-errors";
import {
  buildExecutionQueueErrorResponse,
  buildExecutionRateLimitResponse,
} from "./execution-api-responses";

describe("execution API responses", () => {
  it("returns 429 only for a real rate-limit decision", async () => {
    const response = buildExecutionRateLimitResponse({
      allowed: false,
      retryAfter: 13,
      reason: "rate_limited",
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("13");
    await expect(response?.json()).resolves.toMatchObject({
      code: "EXECUTION_RATE_LIMITED",
    });
  });

  it("returns 503 when the rate limiter is unavailable", async () => {
    const response = buildExecutionRateLimitResponse({
      allowed: false,
      retryAfter: 60,
      reason: "unavailable",
    });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: "EXECUTION_ADMISSION_UNAVAILABLE",
    });
  });

  it("distinguishes exhausted capacity from unavailable admission", async () => {
    const full = buildExecutionQueueErrorResponse(
      new ExecutionQueueError("capacity_exceeded", "full"),
    );
    const unavailable = buildExecutionQueueErrorResponse(
      new ExecutionQueueError("capacity_unavailable", "offline"),
    );

    expect(full?.status).toBe(429);
    expect(unavailable?.status).toBe(503);
    await expect(unavailable?.json()).resolves.toMatchObject({
      code: "EXECUTION_ADMISSION_UNAVAILABLE",
    });
  });

  it("returns a distinct 503 when BullMQ is unavailable", async () => {
    const response = buildExecutionQueueErrorResponse(
      new ExecutionQueueError("queue_unavailable", "offline"),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: "EXECUTION_QUEUE_UNAVAILABLE",
    });
  });
});
