import { monitorResumeBlockedResponse } from "./trial-interval-response";

const mockBlockUntilSubscribed = jest.fn();

jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    constructor(
      message: string,
      public reason: string,
    ) {
      super(message);
    }
  }
  return {
    SubscriptionAccessDeniedError,
    subscriptionService: {
      blockUntilSubscribed: (...args: unknown[]) =>
        mockBlockUntilSubscribed(...args),
    },
  };
});
jest.mock("./trial-limits", () => ({ trialCheckIntervalViolation: jest.fn() }));
const mockCheckResumeWithinPlan = jest.fn(async (): Promise<Record<string, unknown>> => ({ allowed: true }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkResumeWithinPlan: (...args: unknown[]) => mockCheckResumeWithinPlan(...(args as [])),
}));

describe("monitorResumeBlockedResponse", () => {
  beforeEach(() => mockBlockUntilSubscribed.mockReset());

  it("answers 403 when resuming would exceed the plan's active monitors", async () => {
    mockBlockUntilSubscribed.mockResolvedValue(undefined);
    mockCheckResumeWithinPlan.mockResolvedValueOnce({
      allowed: false, error: "Your plus plan allows 50 active monitors.", limit: 50, upgrade: "pro",
    });
    const response = await monitorResumeBlockedResponse("org", "paused", { status: "pending" });
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: "plan_limit", limit: 50, upgrade: "pro" });
    expect(mockCheckResumeWithinPlan).toHaveBeenCalledWith("org", "monitor");
  });

  it("answers 402 when a paused monitor is turned back on without a plan", async () => {
    const { SubscriptionAccessDeniedError } = jest.requireMock(
      "@/lib/services/subscription-service",
    );
    mockBlockUntilSubscribed.mockRejectedValue(
      new SubscriptionAccessDeniedError(
        "Active subscription required.",
        "subscription_required",
      ),
    );
    const response = await monitorResumeBlockedResponse("org", "paused", {
      enabled: true,
    });
    expect(response?.status).toBe(402);
    expect(await response?.json()).toEqual({
      error: "Active subscription required.",
      code: "subscription_required",
    });
  });

  it("also blocks resuming through a status of pending", async () => {
    const { SubscriptionAccessDeniedError } = jest.requireMock(
      "@/lib/services/subscription-service",
    );
    mockBlockUntilSubscribed.mockRejectedValue(
      new SubscriptionAccessDeniedError("no", "subscription_required"),
    );
    expect(
      (
        await monitorResumeBlockedResponse("org", "paused", {
          status: "pending",
        })
      )?.status,
    ).toBe(402);
  });

  it("lets an entitled organization resume", async () => {
    mockBlockUntilSubscribed.mockResolvedValue(undefined);
    expect(
      await monitorResumeBlockedResponse("org", "paused", { enabled: true }),
    ).toBeNull();
  });

  it("does not check pausing or monitors that are not paused", async () => {
    expect(
      await monitorResumeBlockedResponse("org", "paused", { enabled: false }),
    ).toBeNull();
    expect(
      await monitorResumeBlockedResponse("org", "up", { enabled: true }),
    ).toBeNull();
    expect(mockBlockUntilSubscribed).not.toHaveBeenCalled();
  });

  it("rethrows unexpected errors", async () => {
    mockBlockUntilSubscribed.mockRejectedValue(new Error("db down"));
    await expect(
      monitorResumeBlockedResponse("org", "paused", { enabled: true }),
    ).rejects.toThrow("db down");
  });
});
