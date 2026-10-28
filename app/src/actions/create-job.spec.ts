/** @jest-environment node */
import { createJob } from "./create-job";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { requirePermissions } from "@/lib/rbac/middleware";

const mockInsert = jest.fn((_table: unknown) => ({ values: jest.fn(async () => {}) }));
const testId = "018f0000-0000-7000-8000-000000000001";
jest.mock("@/utils/db", () => ({ db: {
  insert: (table: unknown) => mockInsert(table),
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
  expect(await createJob(input)).toEqual({ success: false, message: "Insufficient permissions to create jobs" });
  expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
});

it("rejects a sub-minute cron before any write (c10)", async () => {
  const result = await createJob({ ...input, cronSchedule: "* * * * * *" });
  expect(result).toEqual(expect.objectContaining({ success: false }));
  expect(mockInsert).not.toHaveBeenCalled();
});
