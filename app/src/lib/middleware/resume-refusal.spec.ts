/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
const mockStatus = jest.fn();
const mockCount = jest.fn();
let lockBusy = false;
jest.mock("@/lib/middleware/plan-limit-lock", () => {
  class PlanLimitBusyError extends Error {}
  return {
    PlanLimitBusyError,
    notInDeletedProject: () => undefined,
    // The first select in the lock reads the target's status, the next ones count.
    withPlanLimitLock: async (_o: string, _r: string, fn: (tx: unknown) => Promise<unknown>) => {
      if (lockBusy) throw new PlanLimitBusyError();
      let first = true;
      const tx = { select: () => ({ from: () => ({ where: async () => { if (first) { first = false; return mockStatus(); } return mockCount(); } }) }) };
      return fn(tx);
    },
  };
});
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: { getOrganizationPlan: async () => ({ id: "plus", plan: "plus", maxMonitors: 2, maxStatusPages: 1 }) } }));
jest.mock("@/lib/execution/execution-policy", () => ({ getExecutionPolicy: jest.fn() }));
import { ResumeRefusedError, resumeRefusalResponse, withResumeWithinPlan } from "./plan-enforcement";

it("answers nothing when the resume went through", () => {
  expect(resumeRefusalResponse({ ok: true, value: 1 })).toBeNull();
});

it("answers 403 with the plan-limit code when the plan has no free slot", async () => {
  const response = resumeRefusalResponse({ ok: false, denied: { allowed: false, error: "Full", limit: 5, upgrade: "pro" } });
  expect(response?.status).toBe(403);
  expect(await response?.json()).toEqual({ error: "Full", code: "plan_limit", limit: 5, upgrade: "pro" });
});

it("answers 503 with Retry-After when the lock was busy", () => {
  const response = resumeRefusalResponse({ ok: false, busy: true });
  expect(response?.status).toBe(503);
  expect(response?.headers.get("Retry-After")).toBe("2");
});

describe("withResumeWithinPlan", () => {
  beforeEach(() => { lockBusy = false; mockStatus.mockReset(); mockCount.mockReset(); });

  it("writes when the plan has a free slot", async () => {
    mockStatus.mockResolvedValue([{ status: "paused" }]);
    mockCount.mockResolvedValue([{ count: 1 }]);
    await expect(withResumeWithinPlan("org", "monitor", "m1", async () => "done")).resolves.toEqual({ ok: true, value: "done" });
  });

  it("refuses without writing at the limit", async () => {
    mockStatus.mockResolvedValue([{ status: "paused" }]);
    mockCount.mockResolvedValue([{ count: 2 }]);
    const write = jest.fn();
    await expect(withResumeWithinPlan("org", "monitor", "m1", write)).resolves.toMatchObject({ ok: false, denied: { limit: 2 } });
    expect(write).not.toHaveBeenCalled();
  });

  it("does not count a status page that is already published", async () => {
    mockStatus.mockResolvedValue([{ status: "published" }]);
    await expect(withResumeWithinPlan("org", "status_page", "p1", async () => "done")).resolves.toMatchObject({ ok: true });
    expect(mockCount).not.toHaveBeenCalled();
  });

  it("counts published status pages for a draft", async () => {
    mockStatus.mockResolvedValue([{ status: "draft" }]);
    mockCount.mockResolvedValue([{ count: 1 }]);
    await expect(withResumeWithinPlan("org", "status_page", "p1", async () => "done")).resolves.toMatchObject({ ok: false, denied: { limit: 1 } });
  });

  it("re-checks under the lock only for a paused monitor, and a refusal aborts before the write", async () => {
    const guard = jest.fn(async () => { throw new Error("no subscription"); });
    const write = jest.fn();
    mockStatus.mockResolvedValue([{ status: "paused" }]);
    await expect(withResumeWithinPlan("org", "monitor", "m1", write, guard)).rejects.toThrow("no subscription");
    expect(write).not.toHaveBeenCalled();

    guard.mockClear();
    mockStatus.mockResolvedValue([{ status: "up" }]);
    await expect(withResumeWithinPlan("org", "monitor", "m1", async () => "done", guard)).resolves.toMatchObject({ ok: true });
    expect(guard).not.toHaveBeenCalled();
  });

  it("reports busy when the lock cannot be taken", async () => {
    lockBusy = true;
    await expect(withResumeWithinPlan("org", "monitor", "m1", async () => "done")).resolves.toEqual({ ok: false, busy: true });
  });

  it("carries the refusal in ResumeRefusedError", () => {
    const outcome = { ok: false as const, busy: true as const };
    expect(new ResumeRefusedError(outcome).outcome).toBe(outcome);
  });
});
