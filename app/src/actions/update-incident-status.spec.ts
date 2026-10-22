jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({
    userId: "user",
    organizationId: "00000000-0000-4000-8000-000000000002",
    project: { id: "00000000-0000-4000-8000-000000000003" },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requirePermissions: jest.fn(async () => undefined),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { incidentScheduleFields } from "@/lib/incident-schedule";
import { updateIncidentStatus } from "./update-incident-status";
import { updateIncidentStatusSchema } from "@/lib/validations/incident-status";

const input = {
  incidentId: "00000000-0000-4000-8000-000000000001",
  statusPageId: "00000000-0000-4000-8000-000000000002",
  status: "scheduled" as const,
  body: "Maintenance is about to begin.",
  deliverNotifications: true,
  restoreComponentStatus: false,
};

describe("scheduled incident updates", () => {
  it("rejects a direct call without a maintenance window", async () => {
    const result = await updateIncidentStatus(input);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Start time is required/i);
  });

  it("rejects an end before the start at the schema boundary", () => {
    const result = updateIncidentStatusSchema.safeParse({
      ...input,
      scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000),
      scheduledUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(result.success).toBe(false);
  });

  it("clears the maintenance window when moving to a normal incident state", () => {
    expect(
      incidentScheduleFields("investigating", new Date(), new Date()),
    ).toEqual({ scheduledFor: null, scheduledUntil: null });
    expect(
      incidentScheduleFields("resolved", new Date(), new Date()),
    ).toEqual({ scheduledFor: null, scheduledUntil: null });
  });

  it("keeps the maintenance window while maintenance is in progress", () => {
    expect(
      incidentScheduleFields("monitoring", new Date(), new Date()),
    ).toEqual({});
  });
});
