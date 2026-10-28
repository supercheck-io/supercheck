/** @jest-environment node */
import { scheduleCronJob } from "./schedule-job";
import { scheduleJob } from "@/lib/job-scheduler";

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p", name: "P", userRole: "admin" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/job-scheduler", () => ({ scheduleJob: jest.fn() }));

it.each(["", "   ", "\t"])("rejects the blank cron %j before the scheduler is touched", async (cron) => {
  const result = await scheduleCronJob("job", cron);
  expect(result).toEqual({ success: false, error: "Cron expression is required" });
  expect(scheduleJob).not.toHaveBeenCalled();
});
