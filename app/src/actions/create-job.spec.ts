/** @jest-environment node */
// Permission denials ask whether the organization is pending deletion; these specs run without a database.
jest.mock("@/lib/deletion/org-state", () => {
  const overrides: Record<string, unknown> = {
    isOrgPendingDeletion: async () => false,
    isProjectDeleted: async () => false,
    isProjectOrgPending: async () => false,
    permissionDeniedResponse: async (_org: unknown, message: string) => Response.json({ error: message }, { status: 403 }),
    permissionDeniedResult: async (_org: unknown, message: string) => ({ success: false, error: message, message }),
  };
  return new Proxy({}, { get: (_t, key: string) => (key in overrides ? overrides[key] : jest.requireActual("@/lib/deletion/org-state")[key]) });
});
import { createJob } from "./create-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { requirePermissions } from "@/lib/rbac/middleware";
import { scheduleJob } from "@/lib/job-scheduler";

const mockInsert = jest.fn((_table: unknown) => ({ values: jest.fn(async () => {}) }));
const testId = "018f0000-0000-7000-8000-000000000001";
const mockUpdateSet = jest.fn((_values: unknown) => ({ where: jest.fn(async () => {}) }));
jest.mock("@/utils/db", () => ({ db: {
  insert: (table: unknown) => mockInsert(table),
  update: () => ({ set: (values: unknown) => mockUpdateSet(values) }),
  select: () => ({ from: () => ({ where: async () => [{ id: testId, type: "browser" }] }) }),
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: async () => ({
  userId: "user", organizationId: "org", project: { id: "project", name: "Project" },
}) }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn(async () => {}) }));
jest.mock("@/lib/job-scheduler", () => ({ scheduleJob: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({
  SubscriptionAccessDeniedError: class extends Error {},
  subscriptionService: {
    blockUntilSubscribed: jest.fn(async () => {}),
    requireValidPolarCustomer: jest.fn(async () => {}),
  },
}));

const input = { name: "Job", description: "", jobType: "playwright" as const, tests: [{ id: testId }] };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(subscriptionService.blockUntilSubscribed).mockReset().mockResolvedValue();
  jest.mocked(subscriptionService.requireValidPolarCustomer).mockReset().mockResolvedValue();
  jest.mocked(requirePermissions).mockReset().mockResolvedValue(undefined as never);
});

it.each(["blockUntilSubscribed", "requireValidPolarCustomer"] as const)(
  "rejects a direct action before writes when %s denies access", async (guard) => {
    jest.mocked(subscriptionService[guard]).mockRejectedValue(
      new SubscriptionAccessDeniedError("Subscription required", "subscription_required"),
    );
    expect(await createJob(input)).toEqual({ success: false, message: "Subscription required", error: "Subscription required" });
    expect(mockInsert).not.toHaveBeenCalled();
  },
);
it("allows a permitted organization after both subscription checks", async () => {
  expect(await createJob(input)).toEqual(expect.objectContaining({ success: true }));
  expect(subscriptionService.blockUntilSubscribed).toHaveBeenCalledWith("org");
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith("org");
  expect(mockInsert).toHaveBeenCalledTimes(2);
});
it("checks authorization before billing", async () => {
  jest.mocked(requirePermissions).mockRejectedValue(new Error("Denied"));
  expect(await createJob(input)).toEqual({ success: false, error: "Insufficient permissions to create jobs", message: "Insufficient permissions to create jobs" });
  expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
});

it("rejects a sub-minute cron before any write (c10)", async () => {
  const result = await createJob({ ...input, cronSchedule: "* * * * * *" });
  expect(result).toEqual(expect.objectContaining({ success: false }));
  expect(mockInsert).not.toHaveBeenCalled();
});

it("creates the job but warns, with no next run, when its schedule cannot be registered", async () => {
  jest.mocked(scheduleJob).mockRejectedValueOnce(new Error("queue_unavailable"));
  const result = await createJob({ ...input, cronSchedule: "0 * * * *" });
  expect(result).toEqual(expect.objectContaining({
    success: true,
    warning: "Job created, but its schedule could not be registered.",
    job: expect.objectContaining({ nextRunAt: null, scheduledJobId: null }),
  }));
  expect(mockUpdateSet).toHaveBeenCalledWith({ nextRunAt: null });
});

it("returns no warning when the schedule registers", async () => {
  jest.mocked(scheduleJob).mockResolvedValueOnce("job-scheduled");
  const result = await createJob({ ...input, cronSchedule: "0 * * * *" });
  expect(result).toEqual(expect.objectContaining({ success: true }));
  expect(result).not.toHaveProperty("warning");
  expect((result as { job: { nextRunAt: string | null } }).job.nextRunAt).not.toBeNull();
});

it("keeps a registered schedule when storing its scheduler ID fails", async () => {
  jest.mocked(scheduleJob).mockResolvedValueOnce("job-scheduled");
  mockUpdateSet.mockReturnValueOnce({ where: jest.fn(async () => { throw new Error("db blip"); }) });
  const result = await createJob({ ...input, cronSchedule: "0 * * * *" });
  expect(result).toEqual(expect.objectContaining({ success: true }));
  expect(result).not.toHaveProperty("warning");
  expect(mockUpdateSet).not.toHaveBeenCalledWith({ nextRunAt: null });
});

it("still reports the created job when clearing nextRunAt fails", async () => {
  jest.mocked(scheduleJob).mockRejectedValueOnce(new Error("queue_unavailable"));
  mockUpdateSet.mockReturnValueOnce({ where: jest.fn(async () => { throw new Error("db blip"); }) });
  const result = await createJob({ ...input, cronSchedule: "0 * * * *" });
  expect(result).toEqual(expect.objectContaining({
    success: true,
    warning: "Job created, but its schedule could not be registered.",
  }));
});
