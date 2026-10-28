/** @jest-environment node */
import { updateJob } from "./update-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

const mockSelect = jest.fn();
jest.mock("server-only", () => ({}));
const mockSet = jest.fn();
const mockWrite = () => ({ set: (v: unknown) => (mockSet(v), { where: async () => undefined }), values: async () => undefined, where: async () => undefined });
jest.mock("@/utils/db", () => ({ db: { select: (...args: unknown[]) => mockSelect(...args), update: () => mockWrite(), insert: () => mockWrite(), delete: () => mockWrite() } }));
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
