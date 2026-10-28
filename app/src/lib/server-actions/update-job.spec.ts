/** @jest-environment node */
import { updateJob } from "./update-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

const mockSelect = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("@/utils/db", () => ({ db: { select: (...args: unknown[]) => mockSelect(...args) } }));
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

it("accepts an inherited null threshold instead of failing an unrelated edit", async () => {
  mockSelect.mockImplementation(() => { throw new Error("lookup reached"); });
  const alertConfig = { enabled: false, notificationProviders: [], alertOnFailure: true, failureThreshold: null, recoveryThreshold: null };
  await updateJob({ ...input, alertConfig } as never, { ...context, inherited: { alertConfig: true } });
  expect(mockSelect).toHaveBeenCalled();
});
