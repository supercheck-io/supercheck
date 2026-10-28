/** @jest-environment node */
import { updateJob } from "./update-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { scheduleJob } from "@/lib/job-scheduler";

const mockSelect = jest.fn();
jest.mock("server-only", () => ({}));
const mockWriter = {
  update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => undefined) })) })),
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
