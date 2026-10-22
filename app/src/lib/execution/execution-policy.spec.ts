/** @jest-environment node */
import { getExecutionPolicy, assertExecutionWorkload, type ExecutionPolicy } from "./execution-policy";
import { createTrialK6Script } from "./trial-k6-workload";
import { requireVerifiedTarget, TargetDomainError } from "./target-domain-registry";
jest.mock("./target-domain-registry", () => ({ requireVerifiedTarget: jest.fn(), TargetDomainError: class extends Error {} }));
import { db } from "@/utils/db";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

jest.mock("@/utils/db", () => ({ db: { query: { executionEntitlements: { findFirst: jest.fn() } } } }));
jest.mock("@/lib/feature-flags", () => ({ isCloudHosted: jest.fn(), isPolarEnabled: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {}
  return { SubscriptionAccessDeniedError, subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn(), getOrganizationPlan: jest.fn() } };
});
const trial = { organizationId: "org", expiresAt: new Date(Date.now() + 60_000), runningCapacity: 1, queuedCapacity: 10, k6MaxVus: 5, playwrightBudgetMs: 1800000, playwrightUsedMs: 0 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isCloudHosted).mockReturnValue(true);
  jest.mocked(isPolarEnabled).mockReturnValue(true);
  jest.mocked(subscriptionService.blockUntilSubscribed).mockResolvedValue();
  jest.mocked(subscriptionService.requireValidPolarCustomer).mockResolvedValue();
  jest.mocked(subscriptionService.getOrganizationPlan).mockResolvedValue({ runningCapacity: 3, queuedCapacity: 30 } as Awaited<ReturnType<typeof subscriptionService.getOrganizationPlan>>);
  jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue(undefined);
});
it("keeps entitled organizations ahead of trials using current plan limits", async () => {
  await expect(getExecutionPolicy("org")).resolves.toMatchObject({ tier: "paid", priority: 0, runningCapacity: 3, queuedCapacity: 30 });
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith("org");
});
it("allows a separately recorded unexpired trial after access denial", async () => {
  jest.mocked(subscriptionService.blockUntilSubscribed).mockRejectedValue(new SubscriptionAccessDeniedError("inactive", "subscription_required"));
  jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue(trial);
  await expect(getExecutionPolicy("org")).resolves.toMatchObject({ tier: "trial", priority: 1, runningCapacity: 1, queuedCapacity: 10 });
});
it("refuses missing or expired cloud entitlements instead of defaulting to capacity", async () => {
  jest.mocked(isPolarEnabled).mockReturnValue(false);
  await expect(getExecutionPolicy("org")).rejects.toThrow("Execution entitlement required");
  jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue({ ...trial, expiresAt: new Date(0) });
  await expect(getExecutionPolicy("org")).rejects.toThrow("Execution entitlement required");
});
it("does not turn operational failures into trial access", async () => {
  jest.mocked(subscriptionService.blockUntilSubscribed).mockRejectedValue(new Error("database unavailable"));
  jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue(trial);
  await expect(getExecutionPolicy("org")).rejects.toThrow("database unavailable");
});
it("preserves self hosted capacity overrides", async () => {
  jest.mocked(isCloudHosted).mockReturnValue(false);
  const previous = process.env.RUNNING_CAPACITY;
  process.env.RUNNING_CAPACITY = "7";
  try { await expect(getExecutionPolicy("org")).resolves.toMatchObject({ tier: "paid", runningCapacity: 7 }); }
  finally { if (previous === undefined) Reflect.deleteProperty(process.env, "RUNNING_CAPACITY"); else process.env.RUNNING_CAPACITY = previous; }
});

describe("local execution capacity", () => {
  beforeEach(() => { jest.mocked(isCloudHosted).mockReturnValue(false); });
  it("uses existing plan capacity when no environment overrides exist", async () => {
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({ runningCapacity: 3, queuedCapacity: 30 });
  });
  it("uses established local defaults when the plan lookup fails", async () => {
    jest.mocked(subscriptionService.getOrganizationPlan).mockRejectedValueOnce(new Error("unconfigured"));
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({ runningCapacity: 5, queuedCapacity: 50 });
  });
  it("uses the local default for the other capacity when only one override exists", async () => {
    const previous = process.env.QUEUED_CAPACITY;
    process.env.QUEUED_CAPACITY = "80";
    try { await expect(getExecutionPolicy("org")).resolves.toMatchObject({ runningCapacity: 5, queuedCapacity: 80 }); }
    finally { if (previous === undefined) Reflect.deleteProperty(process.env, "QUEUED_CAPACITY"); else process.env.QUEUED_CAPACITY = previous; }
  });
});

describe("trial workload admission", () => {
  const policy: ExecutionPolicy = { tier: "trial", priority: 1, runningCapacity: 1, queuedCapacity: 10, expiresAt: new Date(Date.now() + 60_000), k6MaxVus: 2, playwrightRemainingMs: 1000 };
  it("refuses arbitrary scripts, multiple workloads, and excessive VUs before domain checks", async () => {
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 3, durationSeconds: 1 });
    await expect(assertExecutionWorkload("org", policy, "k6", ["import http from 'k6/http';"])).rejects.toThrow("generated HTTP workload");
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical, canonical])).rejects.toThrow("one generated");
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical])).rejects.toThrow("trial VU");
    expect(requireVerifiedTarget).not.toHaveBeenCalled();
  });
  it("checks exact organization domain ownership for an accepted canonical workload", async () => {
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 2, durationSeconds: 1 });
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical])).resolves.toBeUndefined();
    expect(requireVerifiedTarget).toHaveBeenCalledWith("org", "example.com");
  });
  it("does not expose storage errors as workload rejection messages", async () => {
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 1, durationSeconds: 1 });
    jest.mocked(requireVerifiedTarget).mockRejectedValueOnce(new Error("internal query failure"));
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical])).rejects.toThrow("internal query failure");
    jest.mocked(requireVerifiedTarget).mockRejectedValueOnce(new TargetDomainError("Domain ownership proof required", 400));
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical])).rejects.toMatchObject({ status: 400, message: "Domain ownership proof required" });
  });
  it("refuses exhausted browser quotas and workloads longer than the remaining trial", async () => {
    await expect(assertExecutionWorkload("org", { ...policy, playwrightRemainingMs: 0 }, "playwright", [])).rejects.toMatchObject({ status: 402 });
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 1, durationSeconds: 120 });
    await expect(assertExecutionWorkload("org", policy, "k6", [canonical])).rejects.toThrow("remaining duration");
  });
});
