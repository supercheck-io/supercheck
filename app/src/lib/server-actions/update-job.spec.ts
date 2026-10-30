/** @jest-environment node */
import { updateJob } from "./update-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { scheduleJob } from "@/lib/job-scheduler";

const mockSelect = jest.fn();
jest.mock("server-only", () => ({}));
const mockSet = jest.fn();
const mockWhere = jest.fn();
const mockUpdatedRows = jest.fn(() => [{ id: "job" }]);
const mockWriter = {
  update: jest.fn(() => ({
    set: jest.fn((v: unknown) => (mockSet(v), {
      where: jest.fn((cond: unknown) => (mockWhere(cond), Object.assign(Promise.resolve(undefined), { returning: async () => mockUpdatedRows() }))),
    })),
  })),
  delete: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
  insert: jest.fn(() => ({ values: jest.fn(async () => undefined) })),
};
const mockTransaction = jest.fn(async (fn: (tx: typeof mockWriter) => unknown) => fn(mockWriter));
jest.mock("@/utils/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => (mockWriter.update as (...a: unknown[]) => unknown)(...args),
    delete: (...args: unknown[]) => (mockWriter.delete as (...a: unknown[]) => unknown)(...args),
    insert: (...args: unknown[]) => (mockWriter.insert as (...a: unknown[]) => unknown)(...args),
    transaction: (fn: never) => mockTransaction(fn),
  },
}));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/job-scheduler", () => ({ scheduleJob: jest.fn(), deleteScheduledJob: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/notification-providers/ownership", () => ({ validateNotificationProviderOwnership: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({
  SubscriptionAccessDeniedError: class extends Error {},
  subscriptionService: {
    blockUntilSubscribed: jest.fn(async () => {}),
    requireValidPolarCustomer: jest.fn(async () => {}),
  },
}));

const context = { userId: "user", organizationId: "org", project: { id: "project", name: "P", userRole: "admin" } };
const input = { jobId: "018f0000-0000-7000-8000-000000000002", name: "Job", description: "", cronSchedule: "*/5 * * * *" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  jest.mocked(subscriptionService.blockUntilSubscribed).mockReset().mockResolvedValue();
  jest.mocked(subscriptionService.requireValidPolarCustomer).mockReset().mockResolvedValue();
});

it.each(["blockUntilSubscribed", "requireValidPolarCustomer"] as const)(
  "rejects an edit before any database access when %s denies access",
  async (guard) => {
    jest.mocked(subscriptionService[guard]).mockRejectedValue(
      new SubscriptionAccessDeniedError("Subscription required", "subscription_required"),
    );
    expect(await updateJob(input, context)).toEqual({
      success: false,
      message: "Subscription required",
      error: "Subscription required",
    });
    expect(mockSelect).not.toHaveBeenCalled();
  },
);

it("checks authorization before billing", async () => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(false);
  expect(await updateJob(input, context)).toEqual({ success: false, message: "Insufficient permissions to edit jobs" });
  expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
});

it("proceeds to the job lookup once both subscription checks pass", async () => {
  mockSelect.mockImplementation(() => { throw new Error("lookup reached"); });
  const result = await updateJob(input, context);
  expect(subscriptionService.blockUntilSubscribed).toHaveBeenCalledWith("org");
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith("org");
  expect(mockSelect).toHaveBeenCalled();
  expect(result).toEqual(expect.objectContaining({ success: false }));
});

describe("saving a job", () => {
  const TEST_A = "018f0000-0000-7000-8000-00000000000a";
  const TEST_B = "018f0000-0000-7000-8000-00000000000b";
  const rows = (value: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(value).then(resolve);
    return chain;
  };
  const arrange = (jobType: string, scoped: Array<{ id: string; type: string }>) => {
    mockSelect
      .mockReturnValueOnce(rows([{ id: input.jobId, jobType, cronSchedule: null, scheduledJobId: null, projectId: "project", organizationId: "org" }]))
      .mockReturnValueOnce(rows([]))
      .mockReturnValueOnce(rows(scoped));
  };

  it("rejects a k6 job with more than one test, since only the first would run", async () => {
    arrange("k6", [{ id: TEST_A, type: "performance" }, { id: TEST_B, type: "performance" }]);
    const result = await updateJob({ ...input, tests: [{ id: TEST_A }, { id: TEST_B }] }, context);
    expect(result).toEqual(expect.objectContaining({ success: false, message: expect.stringContaining("exactly one") }));
  });

  it("still lets a legacy multi-test k6 job be edited when its tests are not changed", async () => {
    mockSelect
      .mockReturnValueOnce(rows([{ id: input.jobId, jobType: "k6", cronSchedule: null, scheduledJobId: null, projectId: "project", organizationId: "org" }]))
      .mockReturnValueOnce(rows([{ id: TEST_A }, { id: TEST_B }]))
      .mockReturnValueOnce(rows([{ id: TEST_A, type: "performance" }, { id: TEST_B, type: "performance" }]));
    const result = await updateJob(input, context);
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it("writes the job and its tests in one transaction", async () => {
    arrange("playwright", [{ id: TEST_A, type: "browser" }]);
    const result = await updateJob({ ...input, tests: [{ id: TEST_A }] }, context);
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports a warning, and no next run, when the schedule could not be registered", async () => {
    arrange("playwright", [{ id: TEST_A, type: "browser" }]);
    jest.mocked(scheduleJob).mockRejectedValueOnce(new Error("redis down"));
    const result = await updateJob({ ...input, tests: [{ id: TEST_A }] }, context);
    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect((result as { job: { warning?: string; nextRunAt: string | null } }).job.warning).toEqual(expect.any(String));
    expect((result as { job: { nextRunAt: string | null } }).job.nextRunAt).toBeNull();
  });
});

it.each([
  ["a sub-minute cron", { cronSchedule: "* * * * * *" }],
  ["a fractional threshold", { alertConfig: { enabled: false, notificationProviders: [], alertOnFailure: true, failureThreshold: 2.5, recoveryThreshold: 1 } }],
])("rejects %s before any database access (c10, c16)", async (_name, extra) => {
  const result = await updateJob({ ...input, ...extra }, context);
  expect(result).toEqual(expect.objectContaining({ success: false }));
  expect(mockSelect).not.toHaveBeenCalled();
});

it("does not re-validate a legacy stored cron or threshold that the caller only inherited", async () => {
  mockSelect.mockImplementation(() => { throw new Error("lookup reached"); });
  const legacy = {
    ...input,
    cronSchedule: "* * * * * *",
    alertConfig: { enabled: false, notificationProviders: [], alertOnFailure: true, failureThreshold: 500, recoveryThreshold: 1 },
  };
  await updateJob(legacy, { ...context, inherited: { cronSchedule: true, alertConfig: true } });
  expect(mockSelect).toHaveBeenCalled();
});

it("only caps a description the caller supplied, not an inherited legacy one", async () => {
  mockSelect.mockImplementation(() => { throw new Error("lookup reached"); });
  const legacy = { ...input, description: "x".repeat(5000) };
  await updateJob(legacy, { ...context, inherited: { description: true } });
  expect(mockSelect).toHaveBeenCalled();
  mockSelect.mockClear();
  expect(await updateJob(legacy, context)).toMatchObject({ success: false, message: expect.stringContaining("2000") });
  expect(mockSelect).not.toHaveBeenCalled();
});

it("accepts an inherited null threshold instead of failing an unrelated edit", async () => {
  mockSelect.mockImplementation(() => { throw new Error("lookup reached"); });
  const alertConfig = { enabled: false, notificationProviders: [], alertOnFailure: true, failureThreshold: null, recoveryThreshold: null };
  await updateJob({ ...input, alertConfig } as never, { ...context, inherited: { alertConfig: true } });
  expect(mockSelect).toHaveBeenCalled();
});

function mockJob(stored: unknown) {
  const testId = "018f0000-0000-7000-8000-0000000000a1";
  mockSelect
    .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: input.jobId, jobType: "playwright", alertConfig: stored }] }) }) })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [{ id: testId }] }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: testId, type: "browser" }] }) });
}

it("update without alertOnFailure keeps a stored false", async () => {
  mockJob({ enabled: false, notificationProviders: [], alertOnFailure: false, alertOnSuccess: true, failureThreshold: 3, recoveryThreshold: 2 });
  const result = await updateJob({ ...input, alertConfig: { customMessage: "hi" } } as never, context);
  expect(result).toMatchObject({ success: true });
  expect(mockSet.mock.calls[0][0].alertConfig).toMatchObject({ alertOnFailure: false, failureThreshold: 3, recoveryThreshold: 2, customMessage: "hi" });
});

it("applies create defaults when no alertConfig is stored", async () => {
  mockJob(null);
  await updateJob({ ...input, alertConfig: { alertOnSuccess: true } } as never, context);
  expect(mockSet.mock.calls[0][0].alertConfig).toMatchObject({ enabled: false, alertOnFailure: true, failureThreshold: 1, recoveryThreshold: 1, alertOnSuccess: true });
});

describe("input limits and concurrent edits", () => {
  it.each([
    ["a blank name", { name: "   " }, "name is required"],
    ["a name over 255 characters", { name: "x".repeat(256) }, "255"],
    ["a description over 2000 characters", { description: "x".repeat(2001) }, "2000"],
  ])("rejects %s with a readable message and no database access", async (_label, extra, text) => {
    const result = (await updateJob({ ...input, ...extra }, context)) as { success: boolean; message: string; error: unknown };
    expect(result.success).toBe(false);
    expect(result.message).toContain(text);
    expect(typeof result.error).toBe("string");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  describe("more than 50 tests", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `018f0000-0000-7000-8000-${String(i).padStart(12, "0")}`);
    const chain = (value: unknown[]) => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(value).then(resolve);
      return c;
    };
    const arrange = (current: string[]) => mockSelect.mockReset()
      .mockReturnValueOnce(chain([{ id: input.jobId, jobType: "playwright", cronSchedule: null, scheduledJobId: null, projectId: "project", organizationId: "org" }]))
      .mockReturnValueOnce(chain(current.map((id) => ({ id }))))
      .mockReturnValueOnce(chain(ids.map((id) => ({ id, type: "browser" }))));

    it("rejects a changed selection over the cap", async () => {
      arrange([]);
      expect(await updateJob({ ...input, tests: ids.map((id) => ({ id })) }, context)).toMatchObject({ success: false, message: expect.stringContaining("at most 50") });
    });

    it("lets an unchanged legacy selection over the cap through", async () => {
      arrange(ids);
      const result = (await updateJob({ ...input, tests: ids.map((id) => ({ id })) }, context)) as { message?: string };
      expect(result.message ?? "").not.toContain("at most 50");
    });
  });

  it("reports a conflict when the job changed since the editor loaded it", async () => {
    mockJob(null);
    mockUpdatedRows.mockReturnValueOnce([]);
    const result = await updateJob({ ...input, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }, context);
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("changed since you opened it") });
  });

  it("only adds the updatedAt condition when the caller supplies expectedUpdatedAt", async () => {
    mockJob(null);
    await updateJob(input, context);
    const chunks = () => (mockWhere.mock.calls[0][0] as { queryChunks: unknown[] }).queryChunks.length;
    const without = chunks();
    mockWhere.mockClear();
    mockJob(null);
    await updateJob({ ...input, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }, context);
    expect(chunks()).toBeGreaterThan(without);
  });
});
