/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/utils/db", () => ({
  db: { select: jest.fn(), transaction: jest.fn(), query: {
    sreIncidents: { findFirst: jest.fn() },
    sreInvestigationReports: { findFirst: jest.fn().mockResolvedValue(null) },
  } },
}));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/sre/lib/session-store", () => ({ listSreConversations: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/triage-automation", () => ({ maybeRunAutomaticSreTriage: jest.fn() }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreInvestigationAgentEnabled: jest.fn(() => true) }));

import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getSreIncidentDetails, updateSreIncident } from "./sre-incidents";

function selectRows(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  });
}

describe("getSreIncidentDetails investigation summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  });

  it.each(["failed", "aborted", "timed_out"])("shows the safe error for %s instead of partial findings", async (status) => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ id: "incident-1" }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{
        id: "run-1", status, rootCauseHypothesis: "Unconfirmed hypothesis",
        agentStateSnapshot: { summary: "Partial report", error: "Investigation did not finish" },
      }]))
      .mockReturnValue(selectRows([]));
    const result = await getSreIncidentDetails("incident-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.detail.latestInvestigation?.summary).toBe("Investigation did not finish");
    }
  });

  it.each([
    ["timed_out", {}, "SRE investigation did not complete. Please try again."],
    ["completed", {}, "Confirmed hypothesis"],
    ["completed", { summary: "Completed report" }, "Completed report"],
  ])("preserves the appropriate fallback for %s with %j", async (status, agentStateSnapshot, summary) => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ id: "incident-1" }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{
        id: "run-1", status, rootCauseHypothesis: "Confirmed hypothesis", agentStateSnapshot,
      }]))
      .mockReturnValue(selectRows([]));
    const result = await getSreIncidentDetails("incident-1");
    expect(result.success).toBe(true);
    if (result.success) expect(result.detail.latestInvestigation?.summary).toBe(summary);
  });

  it("reports a lost update race without adding timeline or audit events", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "investigating" });
    const insert = jest.fn();
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      insert,
    }));
    await expect(updateSreIncident({
      id: incidentId, title: "Updated title", severity: "sev2", status: "identified", primaryServiceId: null,
    })).resolves.toEqual({ success: false, error: "Incident changed by another request — reload and try again" });
    expect(insert).not.toHaveBeenCalled();
    expect(jest.requireMock("@/lib/audit-logger").logAuditEvent).not.toHaveBeenCalled();
  });
});
