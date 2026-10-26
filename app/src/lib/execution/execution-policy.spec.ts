/** @jest-environment node */
import {
  clearExecutionPolicyCache,
  POLICY_TTL_MS,
  getExecutionPolicy,
  assertExecutionWorkload,
  type ExecutionPolicy,
} from "./execution-policy";
import { createTrialK6Script } from "./trial-k6-workload";
import { db } from "@/utils/db";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";
import {
  subscriptionService,
  SubscriptionAccessDeniedError,
} from "@/lib/services/subscription-service";

jest.mock("@/utils/db", () => ({
  db: { query: { executionEntitlements: { findFirst: jest.fn() } }, select: jest.fn() },
}));
jest.mock("@/lib/feature-flags", () => ({
  isCloudHosted: jest.fn(),
  isPolarEnabled: jest.fn(),
}));
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {}
  return {
    SubscriptionAccessDeniedError,
    subscriptionService: {
      blockUntilSubscribed: jest.fn(),
      requireValidPolarCustomer: jest.fn(),
      getOrganizationPlan: jest.fn(),
    },
  };
});
const trial = {
  organizationId: "org",
  expiresAt: new Date(Date.now() + 60_000),
  runningCapacity: 1,
  queuedCapacity: 5,
  k6MaxVus: 5,
  playwrightBudgetMs: 1800000,
  playwrightUsedMs: 0,
  k6BudgetVuMs: 9_000_000,
  k6UsedVuMs: 0,
  trialStartedAt: new Date(0),
  maxMonitors: 5,
  minCheckIntervalMinutes: 5,
  maxStatusPages: 2,
  maxStatusPageSubscribers: 50,
  maxTeamMembers: 3,
  maxProjects: 3,
  sreInvestigationUnits: 5,
  aiCredits: 100,
  lifecycleEndedAt: null,
  midwayNotifiedAt: null,
  endingNotifiedAt: null,
  endedNotifiedAt: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  clearExecutionPolicyCache();
  jest.mocked(isCloudHosted).mockReturnValue(true);
  jest.mocked(isPolarEnabled).mockReturnValue(true);
  jest.mocked(subscriptionService.blockUntilSubscribed).mockResolvedValue();
  jest
    .mocked(subscriptionService.requireValidPolarCustomer)
    .mockResolvedValue();
  jest
    .mocked(subscriptionService.getOrganizationPlan)
    .mockResolvedValue({ runningCapacity: 3, queuedCapacity: 30 } as Awaited<
      ReturnType<typeof subscriptionService.getOrganizationPlan>
    >);
  jest
    .mocked(db.query.executionEntitlements.findFirst)
    .mockResolvedValue(undefined);
});
it("keeps entitled organizations ahead of trials using current plan limits", async () => {
  await expect(getExecutionPolicy("org")).resolves.toMatchObject({
    tier: "paid",
    priority: 0,
    runningCapacity: 3,
    queuedCapacity: 30,
  });
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith(
    "org",
    { allowTrial: false },
  );
});
it("allows a separately recorded unexpired trial after access denial", async () => {
  jest
    .mocked(subscriptionService.blockUntilSubscribed)
    .mockRejectedValue(
      new SubscriptionAccessDeniedError("inactive", "subscription_required"),
    );
  jest
    .mocked(db.query.executionEntitlements.findFirst)
    .mockResolvedValue(trial);
  await expect(getExecutionPolicy("org")).resolves.toMatchObject({
    tier: "trial",
    priority: 1,
    runningCapacity: 1,
    queuedCapacity: 5,
  });
});
it("refuses missing or expired cloud entitlements instead of defaulting to capacity", async () => {
  jest.mocked(isPolarEnabled).mockReturnValue(false);
  await expect(getExecutionPolicy("org")).rejects.toThrow(
    "Execution entitlement required",
  );
  jest
    .mocked(db.query.executionEntitlements.findFirst)
    .mockResolvedValue({ ...trial, expiresAt: new Date(0) });
  await expect(getExecutionPolicy("org")).rejects.toThrow(
    "Execution entitlement required",
  );
});
it("does not turn operational failures into trial access", async () => {
  jest
    .mocked(subscriptionService.blockUntilSubscribed)
    .mockRejectedValue(new Error("database unavailable"));
  jest
    .mocked(db.query.executionEntitlements.findFirst)
    .mockResolvedValue(trial);
  await expect(getExecutionPolicy("org")).rejects.toThrow(
    "database unavailable",
  );
});
it("preserves self hosted capacity overrides", async () => {
  jest.mocked(isCloudHosted).mockReturnValue(false);
  const previous = process.env.RUNNING_CAPACITY;
  process.env.RUNNING_CAPACITY = "7";
  try {
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({
      tier: "paid",
      runningCapacity: 7,
    });
  } finally {
    if (previous === undefined)
      Reflect.deleteProperty(process.env, "RUNNING_CAPACITY");
    else process.env.RUNNING_CAPACITY = previous;
  }
});

describe("local execution capacity", () => {
  const originalRunning = process.env.RUNNING_CAPACITY;
  const originalQueued = process.env.QUEUED_CAPACITY;
  beforeEach(() => {
    Reflect.deleteProperty(process.env, "RUNNING_CAPACITY");
    Reflect.deleteProperty(process.env, "QUEUED_CAPACITY");
    jest.mocked(isCloudHosted).mockReturnValue(false);
  });
  afterEach(() => {
    if (originalRunning === undefined) Reflect.deleteProperty(process.env, "RUNNING_CAPACITY");
    else process.env.RUNNING_CAPACITY = originalRunning;
    if (originalQueued === undefined) Reflect.deleteProperty(process.env, "QUEUED_CAPACITY");
    else process.env.QUEUED_CAPACITY = originalQueued;
  });
  it("uses existing plan capacity when no environment overrides exist", async () => {
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({
      runningCapacity: 3,
      queuedCapacity: 30,
    });
  });
  it("uses established local defaults when the plan lookup fails", async () => {
    jest
      .mocked(subscriptionService.getOrganizationPlan)
      .mockRejectedValueOnce(new Error("unconfigured"));
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({
      runningCapacity: 5,
      queuedCapacity: 50,
    });
  });
  it("uses the local default for the other capacity when only one override exists", async () => {
    const previous = process.env.QUEUED_CAPACITY;
    process.env.QUEUED_CAPACITY = "80";
    try {
      await expect(getExecutionPolicy("org")).resolves.toMatchObject({
        runningCapacity: 5,
        queuedCapacity: 80,
      });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "QUEUED_CAPACITY");
      else process.env.QUEUED_CAPACITY = previous;
    }
  });
});

describe("trial workload admission", () => {
  const policy: ExecutionPolicy = {
    tier: "trial",
    priority: 1,
    runningCapacity: 1,
    queuedCapacity: 5,
    expiresAt: new Date(Date.now() + 60_000),
    k6MaxVus: 2,
    k6RemainingVuMs: 9_000_000, playwrightRemainingMs: 1000,
  };
  // Fresh entitlement row plus the allowance held by in-flight reservations, as the worker sees them.
  const mockFresh = (used: { playwrightUsedMs?: number; k6UsedVuMs?: number }, held: { pw?: number; k6?: number } = {}) => {
    jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue({ ...trial, ...used } as never);
    jest.mocked(db.select).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ playwrightHeldMs: held.pw ?? 0, k6HeldVuMs: held.k6 ?? 0 }]) }),
    } as never);
  };
  beforeEach(() => mockFresh({}));
  it("refuses arbitrary scripts, multiple workloads, and excessive VUs before execution", async () => {
    const canonical = createTrialK6Script({
      url: "https://example.com/",
      vus: 3,
      durationSeconds: 1,
    });
    await expect(
      assertExecutionWorkload("org", policy, "k6", [
        "import http from 'k6/http';",
      ]),
    ).rejects.toThrow("generated HTTP workload");
    await expect(
      assertExecutionWorkload("org", policy, "k6", [canonical, canonical]),
    ).rejects.toThrow("one generated");
    await expect(
      assertExecutionWorkload("org", policy, "k6", [canonical]),
    ).rejects.toThrow("trial VU");
  });
  it("admits a canonical trial workload without a registered domain", async () => {
    await expect(assertExecutionWorkload("org", policy, "k6", [createTrialK6Script({
      url: "https://unregistered.example.com/", vus: 2, durationSeconds: 1,
    })])).resolves.toBeUndefined();
  });
  it("refuses exhausted browser quotas and workloads longer than the remaining trial", async () => {
    mockFresh({ playwrightUsedMs: trial.playwrightBudgetMs });
    await expect(
      assertExecutionWorkload("org", policy, "playwright", []),
    ).rejects.toMatchObject({ status: 402 });
    mockFresh({});
    const canonical = createTrialK6Script({
      url: "https://example.com/",
      vus: 1,
      durationSeconds: 120,
    });
    await expect(
      assertExecutionWorkload("org", policy, "k6", [canonical]),
    ).rejects.toThrow("remaining duration");
  });
  it("refuses a load test larger than the remaining VU-millisecond allowance", async () => {
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 5, durationSeconds: 30 });
    const five = { ...policy, k6MaxVus: 5 };
    mockFresh({ k6UsedVuMs: trial.k6BudgetVuMs - 149_999 });
    await expect(assertExecutionWorkload("org", five, "k6", [canonical]))
      .rejects.toMatchObject({ status: 402, message: "Trial load-testing allowance exhausted" });
    mockFresh({ k6UsedVuMs: trial.k6BudgetVuMs - 150_000 });
    await expect(assertExecutionWorkload("org", five, "k6", [canonical])).resolves.toBeUndefined();
  });
  it("subtracts in-flight reservations from a fresh read, ignoring the cached policy", async () => {
    // The cached policy still shows the whole allowance; the worker would refuse this run.
    const stale = { ...policy, k6MaxVus: 5, k6RemainingVuMs: 9_000_000, playwrightRemainingMs: 1_800_000 };
    const canonical = createTrialK6Script({ url: "https://example.com/", vus: 5, durationSeconds: 30 });
    mockFresh({}, { k6: trial.k6BudgetVuMs - 149_999 });
    await expect(assertExecutionWorkload("org", stale, "k6", [canonical])).rejects.toMatchObject({ status: 402 });
    mockFresh({}, { pw: trial.playwrightBudgetMs });
    await expect(assertExecutionWorkload("org", stale, "playwright", [])).rejects.toMatchObject({ status: 402 });
  });
  it("shares one policy resolution between the calls of a request but never caches a failure", async () => {
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue(trial as never);
    await getExecutionPolicy("org");
    await getExecutionPolicy("org");
    expect(db.query.executionEntitlements.findFirst).toHaveBeenCalledTimes(1);

    clearExecutionPolicyCache();
    jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValueOnce(undefined as never);
    await expect(getExecutionPolicy("org")).rejects.toMatchObject({ status: 402 });
    await expect(getExecutionPolicy("org")).resolves.toMatchObject({ tier: "trial" });
  });
  it("keeps a resolution across consecutive 5-second queue passes, so promotion does not re-resolve every tick", async () => {
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    jest.mocked(db.query.executionEntitlements.findFirst).mockResolvedValue(trial as never);
    const now = jest.spyOn(Date, "now");
    const start = Date.now();
    try {
      await getExecutionPolicy("org");
      for (const pass of [5_000, 10_000, 15_000, 25_000]) {
        now.mockReturnValue(start + pass);
        await getExecutionPolicy("org");
      }
      expect(db.query.executionEntitlements.findFirst).toHaveBeenCalledTimes(1);

      // ...but a change is picked up once the window has passed.
      now.mockReturnValue(start + POLICY_TTL_MS + 1);
      await getExecutionPolicy("org");
      expect(db.query.executionEntitlements.findFirst).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  describe("trial browser and API tests", () => {
    it("admits trial scripts targeting unregistered public URLs", async () => {
      await expect(assertExecutionWorkload("org", policy, "playwright", [
        'await page.goto("https://unregistered.example.com/")',
        'await request.get("https://api.example.com/")',
      ])).resolves.toBeUndefined();
    });
    it("does not restrict paid workloads", async () => {
      await expect(assertExecutionWorkload("org", { tier: "paid", priority: 0, runningCapacity: 5, queuedCapacity: 50 },
        "playwright", ['await request.get("https://anything.test/")'])).resolves.toBeUndefined();
    });
  });
});
