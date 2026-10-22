import { ExecutionWorkloadError } from "./execution/execution-policy";
import { ExecutionQueueError } from "./execution-errors";
import { SubscriptionAccessDeniedError } from "./services/subscription-service";
import {
  buildExecutionPolicyFailureResponse,
  buildExecutionQueueErrorResponse,
  buildExecutionRateLimitResponse,
} from "./execution-api-responses";

describe("execution API responses", () => {
  it("preserves actionable workload and quota rejection responses", async () => {
    const invalid = buildExecutionQueueErrorResponse(
      new ExecutionWorkloadError("Generated HTTP workload required"),
    );
    const quota = buildExecutionQueueErrorResponse(
      new ExecutionWorkloadError("Trial quota exhausted", 402),
    );
    expect(invalid?.status).toBe(400);
    expect(quota?.status).toBe(402);
    await expect(invalid?.json()).resolves.toMatchObject({
      error: "Generated HTTP workload required",
    });
  });
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

  describe("buildExecutionPolicyFailureResponse", () => {
    afterEach(() => jest.restoreAllMocks());

    it("reports a subscription denial as 402 with its reason", async () => {
      const response = buildExecutionPolicyFailureResponse(
        new SubscriptionAccessDeniedError(
          "Subscribe to continue",
          "subscription_required",
        ),
      );
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: "Subscribe to continue",
        code: "subscription_required",
      });
    });

    it("reports a missing or expired entitlement as 402", async () => {
      const response = buildExecutionPolicyFailureResponse(
        new ExecutionWorkloadError(
          "Execution entitlement required or trial expired",
          402,
        ),
      );
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        code: "execution_entitlement_required",
      });
    });

    it("hides operational failures behind a generic 500 and logs them", async () => {
      const log = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const response = buildExecutionPolicyFailureResponse(
        new Error('connection to "db.internal:5432" refused'),
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("db.internal");
      expect(body).toEqual({ error: "Execution validation unavailable" });
      expect(log).toHaveBeenCalled();
    });
  });
});
